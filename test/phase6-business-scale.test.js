const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { permissionsForRole } = require('../src/modules/businesses/business-permissions');
const { BusinessMembership } = require('../src/modules/businesses/business-membership.model');
const { BusinessLocation } = require('../src/modules/businesses/business-location.model');
const { BusinessInvitation } = require('../src/modules/staff/business-invitation.model');
const staffService = require('../src/modules/staff/staff.service');
const { InventoryPosition } = require('../src/modules/inventory/inventory-position.model');
const { StockTransfer, TRANSFER_STATUSES } = require('../src/modules/inventory/stock-transfer.model');
const { Delivery, DELIVERY_STATUSES } = require('../src/modules/deliveries/delivery.model');
const deliveryService = require('../src/modules/deliveries/delivery.service');
const inventoryService = require('../src/modules/inventory/inventory.service');
const { checkoutSchema } = require('../src/modules/orders/order.validation');
const { ProductImportJob, PRODUCT_IMPORT_JOB_STATUSES } = require('../src/modules/products/product-import-job.model');
const { productImportJobSchema, productImportJobIdSchema } = require('../src/modules/products/product.validation');
const { businessDeliverySchema } = require('../src/modules/deliveries/delivery.validation');

test('business roles resolve to centralized permissions without granting branch creation to managers', () => {
  assert.ok(permissionsForRole('owner').includes('*'));
  assert.ok(permissionsForRole('administrator').includes('locations.create'));
  assert.ok(!permissionsForRole('manager').includes('locations.create'));
  assert.ok(permissionsForRole('professional').includes('bookings.manage'));
});

test('membership serializes selected branch access and protects invitation token storage', () => {
  const membership = new BusinessMembership({ _id: new mongoose.Types.ObjectId(), userId: new mongoose.Types.ObjectId(), businessId: new mongoose.Types.ObjectId(), role: 'professional', locationAccess: { mode: 'selected', locationIds: [new mongoose.Types.ObjectId()] } });
  assert.equal(membership.toJSONSafe().locationAccess.mode, 'selected');
  assert.deepEqual(BusinessInvitation.schema.path('tokenHash').options.select, false);
  assert.ok(BusinessInvitation.schema.indexes().some(([fields]) => fields.businessId && fields.recipientEmail && fields.status));
});

test('staff activity is exposed through a bounded permissioned list boundary', () => {
  assert.equal(typeof staffService.listActivity, 'function');
  assert.ok(require('../src/modules/staff/staff.validation').listActivitySchema);
});

test('public branch serialization hides exact home-based address and coordinates', () => {
  const location = new BusinessLocation({ _id: new mongoose.Types.ObjectId(), businessId: new mongoose.Types.ObjectId(), name: 'Home studio', address: { addressLine1: 'Private street', area: 'Alagbaka', city: 'Akure', state: 'Ondo', country: 'Nigeria' }, location: { type: 'Point', coordinates: [5.195, 7.252] }, publicExactAddress: false, publiclyVisible: true });
  const safe = location.toJSONSafe(false);
  assert.equal(safe.address.addressLine1, undefined);
  assert.equal(safe.location, null);
  assert.equal(safe.address.area, 'Alagbaka');
});

test('location inventory and transfer models carry branch dimensions and bounded states', () => {
  assert.ok(InventoryPosition.schema.indexes().some(([fields]) => fields.businessId && fields.locationId && fields.productId && fields.variantKey));
  assert.ok(TRANSFER_STATUSES.includes('received'));
  assert.ok(StockTransfer.schema.path('sourceLocationId'));
  assert.ok(StockTransfer.schema.path('destinationLocationId'));
});

test('delivery boundary rejects unconfigured third-party logistics honestly', async () => {
  await assert.rejects(() => deliveryService.quote({ method: 'third_party', subtotalMinor: 10000, currency: 'NGN' }), (error) => error.code === 'DELIVERY_PROVIDER_NOT_CONFIGURED');
  assert.ok(DELIVERY_STATUSES.includes('picked_up_by_customer'));
  assert.ok(Delivery.schema.path('pickupCodeHash').options.select === false);
});

test('pickup verification stays hashed and never leaks through delivery serialization', () => {
  const delivery = new Delivery({
    _id: new mongoose.Types.ObjectId(),
    deliveryNumber: 'SCV-DLV-TEST-001',
    orderId: new mongoose.Types.ObjectId(),
    businessId: new mongoose.Types.ObjectId(),
    locationId: new mongoose.Types.ObjectId(),
    method: 'customer_pickup',
    provider: 'customer_pickup',
    currency: 'NGN',
    pickupCodeHash: deliveryService.hashCode('123456'),
    estimatedPickupAt: new Date('2030-01-01T10:00:00.000Z')
  });
  const safe = delivery.toSafeJSON();
  assert.equal(safe.pickupCodeHash, undefined);
  assert.equal(safe.estimatedPickupAt.toISOString(), '2030-01-01T10:00:00.000Z');
  assert.notEqual(deliveryService.hashCode('123456'), '123456');
});

test('seller delivery assignment is bounded and remains separate from provider dispatch', () => {
  const businessId = new mongoose.Types.ObjectId().toString();
  const deliveryId = new mongoose.Types.ObjectId().toString();
  const valid = businessDeliverySchema.safeParse({ body: { action: 'assign', courier: { name: 'Ayo Courier', phone: '+2348012345678', note: 'Call on arrival' } }, params: { businessId, deliveryId }, query: {} });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.courier.name, 'Ayo Courier');
  const missing = businessDeliverySchema.safeParse({ body: { action: 'assign' }, params: { businessId, deliveryId }, query: {} });
  assert.equal(missing.success, false);
  assert.ok(Delivery.schema.path('courierAssignment'));
});

test('checkout accepts an explicit fulfillment branch without weakening server authority', () => {
  const parsed = checkoutSchema.safeParse({ body: { fulfillmentMethod: 'pickup', fulfillmentLocationId: '507f1f77bcf86cd799439011' }, params: {}, query: {} });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.body.fulfillmentLocationId, '507f1f77bcf86cd799439011');
});

test('inventory forecasting is a read-only bounded service over existing positions and movements', () => {
  assert.equal(typeof inventoryService.forecast, 'function');
  assert.equal(typeof inventoryService.processLowStockAlerts, 'function');
  assert.ok(require('../src/modules/inventory/inventory.validation').forecastSchema);
});

test('low-stock notification keys are stable per position, recipient, and day', () => {
  const positionId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const first = inventoryService.lowStockNotificationKey(positionId, userId, '2026-10-18');
  assert.equal(first, inventoryService.lowStockNotificationKey(positionId.toString(), userId.toString(), '2026-10-18'));
  assert.notEqual(first, inventoryService.lowStockNotificationKey(positionId, userId, '2026-10-19'));
});

test('inventory forecast export is bounded CSV over the existing forecast rows', () => {
  const csv = inventoryService.inventoryForecastCsv([{ productId: 'product-1', product: { name: 'Lagos, Linen' }, locationId: 'location-1', quantityOnHand: 10, quantityReserved: 2, quantityAvailable: 8, lowStockThreshold: 3, unitsSold: 12, dailyAverage: 0.4, daysOfCover: 20, restockRecommended: false }]);
  assert.match(csv, /^product_id,product_name,location_id,/);
  assert.match(csv, /product-1,"Lagos, Linen",location-1,10,2,8,3,12,0\.4,20,false/);
});

test('product CSV imports use an expiring, safe, ownership-scoped job contract', () => {
  const businessId = new mongoose.Types.ObjectId();
  const actorId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const job = new ProductImportJob({ _id: new mongoose.Types.ObjectId(), businessId, actorId, drafts: [{ name: 'Linen', basePriceMinor: 1000, currency: 'NGN' }], validated: 1, created: 1, createdProductIds: [productId], expiresAt: new Date('2026-10-19T00:00:00Z'), status: 'completed' });
  const safe = job.toSafeJSON();
  assert.deepEqual(PRODUCT_IMPORT_JOB_STATUSES, ['queued', 'processing', 'completed', 'failed']);
  assert.equal(ProductImportJob.schema.path('drafts').options.select, false);
  assert.equal(safe.id, job._id.toString());
  assert.equal(safe.created, 1);
  assert.deepEqual(safe.createdProductIds, [productId.toString()]);
  assert.equal(safe.drafts, undefined);
  assert.equal(productImportJobSchema.safeParse({ body: { csv: 'name,price\nLinen,1000' }, params: { businessId: businessId.toString() }, query: {} }).success, true);
  assert.equal(productImportJobIdSchema.safeParse({ body: {}, params: { businessId: businessId.toString(), importJobId: job._id.toString() }, query: {} }).success, true);
});
