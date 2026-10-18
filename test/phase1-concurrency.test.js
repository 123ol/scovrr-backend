const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Order } = require('../src/modules/orders/order.model');
const { InventoryPosition } = require('../src/modules/inventory/inventory-position.model');
const { InventoryReservation, RESERVATION_STATUSES } = require('../src/modules/inventory/inventory-reservation.model');
const { BookingSlotLock } = require('../src/modules/bookings/booking-slot-lock.model');
const { PaymentEvent } = require('../src/modules/payments/payment-event.model');
const { Payment } = require('../src/modules/payments/payment.model');

function indexWithFields(schema, expectedFields) {
  return schema.indexes().find(([fields]) => JSON.stringify(fields) === JSON.stringify(expectedFields));
}

test('checkout idempotency is protected by a customer-scoped unique index', () => {
  const definition = indexWithFields(Order.schema, { customerId: 1, checkoutIdempotencyKey: 1 });
  assert.ok(definition);
  assert.equal(definition[1].unique, true);
  assert.deepEqual(definition[1].partialFilterExpression, { checkoutIdempotencyKey: { $type: 'string' } });
});

test('inventory positions have one unique branch/product/variant position', () => {
  const definition = indexWithFields(InventoryPosition.schema, { businessId: 1, locationId: 1, productId: 1, variantKey: 1 });
  assert.ok(definition);
  assert.equal(definition[1].unique, true);
});

test('inventory reservations expose bounded lifecycle state and expiry lookup', () => {
  assert.deepEqual(RESERVATION_STATUSES, ['active', 'released', 'consumed']);
  const definition = indexWithFields(InventoryReservation.schema, { status: 1, expiresAt: 1 });
  assert.ok(definition);
  assert.equal(InventoryReservation.schema.path('expiresAt').instance, 'Date');
});

test('booking locks use unique resource buckets and TTL cleanup', () => {
  const uniqueDefinition = indexWithFields(BookingSlotLock.schema, { resourceKey: 1, bucketStart: 1 });
  const ttlDefinition = indexWithFields(BookingSlotLock.schema, { expiresAt: 1 });
  assert.ok(uniqueDefinition);
  assert.equal(uniqueDefinition[1].unique, true);
  assert.ok(ttlDefinition);
  assert.equal(ttlDefinition[1].expireAfterSeconds, 0);
});

test('payment webhooks deduplicate provider event ids', () => {
  const definition = indexWithFields(PaymentEvent.schema, { provider: 1, eventId: 1 });
  assert.ok(definition);
  assert.equal(definition[1].unique, true);
});

test('payment initialization supports unique sparse idempotency keys', () => {
  const definition = indexWithFields(Payment.schema, { idempotencyKey: 1 });
  assert.ok(definition);
  assert.equal(definition[1].unique, true);
  assert.equal(definition[1].sparse, true);
});
