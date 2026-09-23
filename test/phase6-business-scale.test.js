const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { permissionsForRole } = require('../src/modules/businesses/business-permissions');
const { BusinessMembership } = require('../src/modules/businesses/business-membership.model');
const { BusinessLocation } = require('../src/modules/businesses/business-location.model');
const { BusinessInvitation } = require('../src/modules/staff/business-invitation.model');
const { InventoryPosition } = require('../src/modules/inventory/inventory-position.model');
const { StockTransfer, TRANSFER_STATUSES } = require('../src/modules/inventory/stock-transfer.model');
const { Delivery, DELIVERY_STATUSES } = require('../src/modules/deliveries/delivery.model');
const deliveryService = require('../src/modules/deliveries/delivery.service');
const { checkoutSchema } = require('../src/modules/orders/order.validation');

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

test('checkout accepts an explicit fulfillment branch without weakening server authority', () => {
  const parsed = checkoutSchema.safeParse({ body: { fulfillmentMethod: 'pickup', fulfillmentLocationId: '507f1f77bcf86cd799439011' }, params: {}, query: {} });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.body.fulfillmentLocationId, '507f1f77bcf86cd799439011');
});
