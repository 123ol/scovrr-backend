const assert = require('node:assert/strict');
const test = require('node:test');
const {
  readLegacyInventory,
  chooseMigrationLocation,
  sameInventoryValues,
  sumPositionValues
} = require('../src/modules/inventory/location-inventory-backfill');
const { parseArgs } = require('../scripts/migrate-location-inventory');
const { INDEX_DEFINITIONS, isLegacyAvailabilityIndex } = require('../scripts/migrate-business-scale-indexes');
const { AvailabilityRule } = require('../src/modules/availability/availability.model');
const { BookingSlotLock } = require('../src/modules/bookings/booking-slot-lock.model');
const { BUSINESS_CAPABILITIES } = require('../src/modules/businesses/business.model');
const { BusinessLocation } = require('../src/modules/businesses/business-location.model');
const { Service } = require('../src/modules/services/service.model');
const { Booking } = require('../src/modules/bookings/booking.model');

test('legacy product stock is normalized for a primary location position', () => {
  const result = readLegacyInventory({ stockQuantity: 12, reservedQuantity: 3, availableQuantity: 9 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, { stockQuantity: 12, reservedQuantity: 3, availableQuantity: 9 });
  assert.equal(sameInventoryValues({ quantityOnHand: 12, quantityReserved: 3, quantityAvailable: 9 }, result.values), true);
});

test('legacy variant stock is represented by the same validated quantity contract', () => {
  const result = readLegacyInventory({ stockQuantity: 1, reservedQuantity: 0, availableQuantity: 1, inventoryTracking: true });
  assert.equal(result.valid, true);
  assert.equal(result.values.stockQuantity, 1);
});

test('zero stock is valid and does not become negative', () => {
  const result = readLegacyInventory({ stockQuantity: 0, reservedQuantity: 0, availableQuantity: 0 });
  assert.equal(result.valid, true);
  assert.ok(Object.values(result.values).every((value) => value >= 0));
});

test('malformed and internally inconsistent legacy quantities are reported', () => {
  assert.equal(readLegacyInventory({ stockQuantity: '12', reservedQuantity: 0, availableQuantity: 12 }).valid, false);
  assert.deepEqual(readLegacyInventory({ stockQuantity: 4, reservedQuantity: 3, availableQuantity: 4 }).conflicts, ['stock_reserved_available_invariant_failed']);
});

test('migration selects the explicit primary, then only a sole active default', () => {
  const primary = { _id: 'primary', active: true, primary: true };
  assert.equal(chooseMigrationLocation([primary, { _id: 'other', active: true }]).location, primary);
  const sole = { _id: 'sole', active: true, primary: false };
  assert.equal(chooseMigrationLocation([sole]).source, 'sole_active_default');
  assert.equal(chooseMigrationLocation([{ _id: 'a', active: true }, { _id: 'b', active: true }]).reason, 'MULTIPLE_ACTIVE_LOCATIONS_WITHOUT_PRIMARY');
  assert.equal(chooseMigrationLocation([]).reason, 'NO_ACTIVE_LOCATION');
});

test('existing positions are compared by aggregate without doubling stock', () => {
  const aggregate = sumPositionValues([
    { quantityOnHand: 5, quantityReserved: 1, quantityAvailable: 4 },
    { quantityOnHand: 7, quantityReserved: 2, quantityAvailable: 5 }
  ]);
  assert.deepEqual(aggregate, { quantityOnHand: 12, quantityReserved: 3, quantityAvailable: 9 });
  assert.equal(sameInventoryValues(aggregate, { stockQuantity: 12, reservedQuantity: 3, availableQuantity: 9 }), true);
});

test('backfill CLI supports dry-run and bounded execution', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--limit', '20']), { dryRun: true, limit: 20, businessId: null });
});

test('explicit index migration covers branch availability, overlap queries, and lock scoping', () => {
  assert.ok(INDEX_DEFINITIONS.some((item) => item.collection === 'availabilityrules' && item.options.unique));
  assert.ok(INDEX_DEFINITIONS.some((item) => item.collection === 'bookings' && item.key.locationId && item.key.staffUserId && item.key.startAt));
  assert.ok(INDEX_DEFINITIONS.some((item) => item.collection === 'blockedperiods' && item.key.active && item.key.startAt));
  assert.ok(INDEX_DEFINITIONS.some((item) => item.collection === 'bookingslotlocks' && item.key.businessId && item.key.bucketStart));
  assert.equal(isLegacyAvailabilityIndex({ key: { businessId: 1, staffUserId: 1 } }), true);
  assert.ok(AvailabilityRule.schema.indexes().some(([fields, options]) => fields.businessId && fields.locationId && fields.staffUserId && options.unique));
  assert.ok(BookingSlotLock.schema.indexes().some(([fields, options]) => fields.resourceKey && fields.bucketStart && options.unique));
  assert.ok(BookingSlotLock.schema.indexes().some(([fields, options]) => fields.expiresAt && options.expireAfterSeconds === 0));
});

test('hybrid business closure keeps products and services under one branch-aware identity', () => {
  assert.deepEqual(BUSINESS_CAPABILITIES, ['marketplace', 'services']);
  assert.ok(Service.schema.path('locationIds'));
  assert.ok(Service.schema.path('staffAssignments'));
  assert.ok(Booking.schema.path('locationId'));
  assert.ok(BusinessLocation.schema.path('openingHours'));
  assert.ok(BusinessLocation.schema.path('pickupInstructions'));
  assert.ok(BusinessLocation.schema.path('delivery.enabled'));
});
