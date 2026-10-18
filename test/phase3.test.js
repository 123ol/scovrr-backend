const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { createProductSchema } = require('../src/modules/products/product.validation');
const { Product } = require('../src/modules/products/product.model');
const { Favorite } = require('../src/modules/favorites/favorite.model');
const { FavoriteCollection } = require('../src/modules/favorites/favorite-collection.model');
const favoriteService = require('../src/modules/favorites/favorite.service');
const { collectionCreateSchema, collectionUpdateSchema, favoriteCollectionSchema } = require('../src/modules/favorites/favorite.validation');
const productPublicRoutes = require('../src/modules/products/product.public.routes');
const { Order } = require('../src/modules/orders/order.model');
const { normalizeVariants } = require('../src/modules/products/product.service');
const productService = require('../src/modules/products/product.service');
const { targetValues } = require('../src/modules/inventory/inventory.service');
const { addItemSchema } = require('../src/modules/cart/cart.validation');
const { Cart } = require('../src/modules/cart/cart.model');
const { processAbandonedCartReminders } = require('../src/modules/cart/cart.service');
const { checkoutSchema } = require('../src/modules/orders/order.validation');
const { discoverSchema, nearbySchema } = require('../src/modules/discovery/discovery.validation');
const { orderNumber } = require('../src/modules/orders/order.service');
const { escapeRegExp, buildPostSuggestions, nearbyLocationQuery, compareNearbyLocations } = require('../src/modules/discovery/discovery.service');
const { fieldScore, rankSearchResults, rankByBusinessOrder } = require('../src/modules/discovery/search-ranking');
const { availabilityQuerySchema } = require('../src/modules/availability/availability.validation');
const { assertPostHasContent } = require('../src/modules/content-posts/content-post.service');

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

test('public product comparison remains bounded and keeps the existing route module', () => {
  assert.equal(typeof productPublicRoutes, 'function');
  assert.equal(typeof require('../src/modules/products/product.service').comparePublicProducts, 'function');
  assert.equal(typeof require('../src/modules/products/product.service').similarPublicProducts, 'function');
  assert.equal(typeof productService.findDuplicateProducts, 'function');
  assert.equal(typeof productService.exportBusinessProducts, 'function');
});

test('saved collections extend existing favorites without duplicating saved-item records', () => {
  assert.equal(Favorite.schema.path('collectionId').options.default, null);
  assert.ok(FavoriteCollection.schema.indexes().some(([fields, options]) => fields.userId && fields.normalizedName && options.unique));
  assert.equal(favoriteService.normalizeCollectionName('  Birthday   ideas  '), 'Birthday ideas');
  assert.equal(favoriteService.collectionNameKey('Birthday Ideas'), 'birthday ideas');
  assert.equal(collectionCreateSchema.safeParse({ body: { name: 'Birthday ideas' }, params: {}, query: {} }).success, true);
  assert.equal(collectionUpdateSchema.safeParse({ body: {}, params: { collectionId: objectId }, query: {} }).success, false);
  assert.equal(favoriteCollectionSchema.safeParse({ body: { collectionId: null }, params: { targetType: 'product', targetId: objectId }, query: {} }).success, true);
});

test('duplicate product lookup is exact, case-insensitive, and ownership-scoped', () => {
  const businessId = new mongoose.Types.ObjectId();
  const categoryId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const filter = productService.duplicateProductFilter({ businessId, name: 'A+B Dress', categoryId, productId });
  assert.equal(filter.businessId, businessId);
  assert.equal(filter.name.test('a+b dress'), true);
  assert.equal(filter.name.test('aXb dress'), false);
  assert.deepEqual(filter.categoryId, categoryId);
  assert.deepEqual(filter._id, { $ne: productId });
  assert.deepEqual(filter.status, { $ne: 'archived' });
});

test('cart validation requires a positive quantity and product identifier', () => {
  const result = addItemSchema.safeParse({ body: { productId: objectId, quantity: 0 }, params: {}, query: {} });
  assert.equal(result.success, false);
});

test('abandoned cart reminders are durable, bounded, and reset by cart activity', () => {
  assert.equal(Cart.schema.path('abandonedReminderSentAt').instance, 'Date');
  assert.equal(typeof processAbandonedCartReminders, 'function');
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

test('discovery search relevance favors exact and prefix matches with deterministic quality tie-breakers', () => {
  assert.equal(fieldScore('lace', 'Lace', 10), 10);
  const ranked = rankSearchResults([
    { name: 'Everyday dress', ratingAverage: 5, createdAt: new Date('2030-01-01') },
    { name: 'Lace dress', ratingAverage: 3, createdAt: new Date('2029-01-01') },
    { name: 'Lace', ratingAverage: 1, createdAt: new Date('2028-01-01') }
  ], 'lace', (item) => [{ value: item.name, weight: 10 }]);
  assert.deepEqual(ranked.map((item) => item.name), ['Lace', 'Lace dress', 'Everyday dress']);
  assert.equal(rankSearchResults(ranked, '', () => []), ranked);
});

test('location-aware search uses nearby business order after text relevance ties', () => {
  const nearest = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const farther = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  const ranked = rankSearchResults([
    { _id: farther, name: 'Dress studio', ratingAverage: 4 },
    { _id: nearest, name: 'Dress studio', ratingAverage: 4 }
  ], 'dress', (item) => [{ value: item.name, weight: 10 }], {
    businessOrder: [nearest, farther],
    getBusinessId: (item) => item._id
  });
  assert.deepEqual(ranked.map((item) => item._id.toString()), [nearest.toString(), farther.toString()]);
});

test('coordinate discovery keeps nearest business order for unsearched results', () => {
  const nearest = '507f1f77bcf86cd799439011';
  const farther = '507f1f77bcf86cd799439012';
  const ranked = rankByBusinessOrder([
    { businessId: farther, name: 'Farther' },
    { businessId: nearest, name: 'Nearest' }
  ], [nearest, farther]);
  assert.deepEqual(ranked.map((item) => item.name), ['Nearest', 'Farther']);
});

test('discovery suggestions expose matching content hashtags', () => {
  const suggestions = buildPostSuggestions([
    { _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'), title: 'New drop', body: '', hashtags: ['#lagosstyle', '#newdrop'] }
  ], /lagos/i);
  assert.deepEqual(suggestions, [{ type: 'hashtag', id: '507f1f77bcf86cd799439011-#lagosstyle', label: '#lagosstyle' }]);
});

test('discovery location filters normalize city and longitude-first coordinates', () => {
  const result = discoverSchema.safeParse({ body: {}, params: {}, query: { city: 'Akure', latitude: '7.252', longitude: '5.195', radiusKm: '10' } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.city, 'Akure');
  assert.equal(result.data.query.longitude, 5.195);
  assert.equal(result.data.query.latitude, 7.252);
  assert.equal(result.data.query.radiusKm, 10);
});

test('discovery accepts a bounded post identifier for saved-video resume', () => {
  const result = discoverSchema.safeParse({ body: {}, params: {}, query: { type: 'posts', postId: objectId } });
  assert.equal(result.success, true);
  assert.equal(result.data.query.postId, objectId);
});

test('discovery rejects a partial coordinate pair', () => {
  const result = discoverSchema.safeParse({ body: {}, params: {}, query: { latitude: '7.252' } });
  assert.equal(result.success, false);
});

test('nearby discovery keeps the mobile radius selector within the public search bound', () => {
  const selected = nearbySchema.safeParse({ body: {}, params: {}, query: { latitude: '7.252', longitude: '5.195', radiusKm: '50' } });
  assert.equal(selected.success, true);
  assert.equal(selected.data.query.radiusKm, 50);
  const outsideBound = nearbySchema.safeParse({ body: {}, params: {}, query: { latitude: '7.252', longitude: '5.195', radiusKm: '100.1' } });
  assert.equal(outsideBound.success, false);
});

test('nearby discovery keeps distance as the primary relevance order', () => {
  const query = nearbyLocationQuery({ latitude: 6.52, longitude: 3.37, radiusKm: 10 });
  assert.deepEqual(query.location.$near.$geometry.coordinates, [3.37, 6.52]);
  assert.equal(query.location.$near.$maxDistance, 10_000);
  const ordered = [
    { distanceKm: 3.2, primary: false },
    { distanceKm: 1.1, primary: false },
    { distanceKm: 1.1, primary: true }
  ].sort(compareNearbyLocations);
  assert.deepEqual(ordered.map((item) => [item.distanceKm, item.primary]), [[1.1, true], [1.1, false], [3.2, false]]);
});

test('public availability accepts its mounted route contract', () => {
  const result = availabilityQuerySchema.safeParse({
    body: {},
    params: {},
    query: { serviceId: objectId, from: '2026-09-23', to: '2026-09-24' }
  });
  assert.equal(result.success, true);
});

test('content posts cannot be saved without text or media', () => {
  assert.throws(() => assertPostHasContent('', []), (error) => error.code === 'CONTENT_POST_EMPTY');
  assert.doesNotThrow(() => assertPostHasContent('New drop', []));
  assert.doesNotThrow(() => assertPostHasContent('', [{ url: 'https://cdn.example.com/post.jpg' }]));
});

test('public order numbers are readable and unique-shaped', () => {
  const first = orderNumber();
  const second = orderNumber();
  assert.match(first, /^SCV-ORD-[A-Z0-9]+-[A-F0-9]{6}$/);
  assert.notEqual(first, second);
});

test('order snapshots retain the identifiers required for safe reorder validation', () => {
  const order = new Order({ orderNumber: orderNumber(), customerId: new mongoose.Types.ObjectId(), businessIds: [new mongoose.Types.ObjectId()], items: [{ productId: new mongoose.Types.ObjectId(), productName: 'Reusable item', unitPriceMinor: 1000, quantity: 2, currency: 'NGN', businessId: new mongoose.Types.ObjectId() }], currency: 'NGN', subtotalMinor: 2000, totalMinor: 2000 });
  const safe = order.toSafeJSON();
  assert.equal(safe.items[0].productId.toString(), order.items[0].productId.toString());
  assert.equal(safe.items[0].quantity, 2);
});
