const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { createProductSchema } = require('../src/modules/products/product.validation');
const { Product } = require('../src/modules/products/product.model');
const { Order } = require('../src/modules/orders/order.model');
const { normalizeVariants } = require('../src/modules/products/product.service');
const { targetValues } = require('../src/modules/inventory/inventory.service');
const { addItemSchema } = require('../src/modules/cart/cart.validation');
const { checkoutSchema } = require('../src/modules/orders/order.validation');
const { discoverSchema } = require('../src/modules/discovery/discovery.validation');
const { orderNumber } = require('../src/modules/orders/order.service');
const { escapeRegExp } = require('../src/modules/discovery/discovery.service');

const objectId = '507f1f77bcf86cd799439011';

test('product validation supports generic variant attributes and smallest-unit money', () => {
  const result = createProductSchema.safeParse({
    body: {
      name: 'Purple Lace Dress',
      basePriceMinor: 3500000,
      currency: 'ngn',
      inventoryTracking: true,
      stockQuantity: 0,
      variants: [{ name: 'Medium / Purple', attributes: { size: 'M', colour: 'Purple' }, priceMinor: 3500000, stockQuantity: 1 }]
    },
    params: { businessId: objectId },
    query: {}
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.currency, 'NGN');
  assert.deepEqual(result.data.body.variants[0].attributes, { size: 'M', colour: 'Purple' });
});

test('cart validation requires a positive quantity and product identifier', () => {
  const result = addItemSchema.safeParse({ body: { productId: objectId, quantity: 0 }, params: {}, query: {} });
  assert.equal(result.success, false);
});

test('checkout validation normalizes fulfillment and ignores untrusted extras', () => {
  const result = checkoutSchema.safeParse({ body: { fulfillmentMethod: 'delivery', unexpected: true }, params: {}, query: {} });
  assert.equal(result.success, true);
  assert.equal(result.data.body.unexpected, undefined);
  const valid = checkoutSchema.safeParse({ body: { fulfillmentMethod: 'pickup' }, params: {}, query: {} });
  assert.equal(valid.success, true);
  assert.equal(valid.data.body.fulfillmentMethod, 'pickup');
});

test('checkout idempotency is unique only for a customer and string key', () => {
  const indexes = Order.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.customerId && fields.checkoutIdempotencyKey && options.unique && options.partialFilterExpression?.checkoutIdempotencyKey?.$type === 'string'));
  assert.equal(Order.schema.path('checkoutIdempotencyKey').options.default, undefined);
});

test('product snapshots preserve the historical business, price and variant', () => {
  const product = new Product({
    _id: new mongoose.Types.ObjectId(),
    businessId: new mongoose.Types.ObjectId(),
    name: 'One-of-one bag',
    basePriceMinor: 1250000,
    currency: 'NGN',
    variants: [{ name: 'Black', priceMinor: 1300000, inventoryTracking: true, stockQuantity: 1, availableQuantity: 1 }]
  });
  const snapshot = product.toSnapshot(product.variants[0].variantId, 1);
  assert.equal(snapshot.productName, 'One-of-one bag');
  assert.equal(snapshot.unitPriceMinor, 1300000);
  assert.equal(snapshot.quantity, 1);
  assert.equal(snapshot.businessId.toString(), product.businessId.toString());
});

test('editing variants preserves server-owned stock and reservation quantities', () => {
  const existing = [{ variantId: new mongoose.Types.ObjectId(), name: 'Medium', inventoryTracking: true, stockQuantity: 4, reservedQuantity: 1, availableQuantity: 3, lowStockThreshold: 1 }];
  const normalized = normalizeVariants([{ variantId: existing[0].variantId, name: 'Medium / Purple', priceMinor: 1500000, inventoryTracking: false, stockQuantity: 999 }], 1200000, existing);
  assert.equal(normalized[0].name, 'Medium / Purple');
  assert.equal(normalized[0].stockQuantity, 4);
  assert.equal(normalized[0].reservedQuantity, 1);
  assert.equal(normalized[0].availableQuantity, 3);
  assert.equal(normalized[0].inventoryTracking, true);
});

test('inventory target selection never treats reserved stock as available stock', () => {
  const product = new Product({ inventoryTracking: true, stockQuantity: 1, reservedQuantity: 1, availableQuantity: 0, variants: [] });
  assert.deepEqual(targetValues(product), { tracked: true, stock: 1, reserved: 1, available: 0 });
});

test('discovery search escapes regular-expression input', () => {
  assert.equal(escapeRegExp('purple + bag'), 'purple \\+ bag');
});

test('discovery location filters normalize city and longitude-first coordinates', () => {
  const result = discoverSchema.safeParse({ body: {}, params: {}, query: { city: 'Akure', latitude: '7.252', longitude: '5.195', radiusKm: '10' } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.city, 'Akure');
  assert.equal(result.data.query.longitude, 5.195);
  assert.equal(result.data.query.latitude, 7.252);
  assert.equal(result.data.query.radiusKm, 10);
});

test('discovery rejects a partial coordinate pair', () => {
  const result = discoverSchema.safeParse({ body: {}, params: {}, query: { latitude: '7.252' } });
  assert.equal(result.success, false);
});

test('public order numbers are readable and unique-shaped', () => {
  const first = orderNumber();
  const second = orderNumber();
  assert.match(first, /^SCV-ORD-[A-Z0-9]+-[A-F0-9]{6}$/);
  assert.notEqual(first, second);
});
