const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { Service } = require('../src/modules/services/service.model');
const { createServiceSchema } = require('../src/modules/services/service.validation');
const { upsertAvailabilitySchema } = require('../src/modules/availability/availability.validation');
const availabilityService = require('../src/modules/availability/availability.service');
const bookingService = require('../src/modules/bookings/booking.service');
const { Booking } = require('../src/modules/bookings/booking.model');

const businessId = new mongoose.Types.ObjectId();
const objectId = '507f1f77bcf86cd799439011';

test('service validation supports deposits, location types, and generic variants', () => {
  const result = createServiceSchema.safeParse({
    body: {
      name: 'Bridal Makeup', basePriceMinor: 2500000, currency: 'ngn', durationMinutes: 120,
      locationTypes: ['at_business', 'at_customer'], paymentRule: 'deposit', depositAmountMinor: 500000,
      variants: [{ name: 'Luxury', priceMinor: 4000000, durationMinutes: 180, active: true }]
    },
    params: { businessId: objectId }, query: {}
  });
  assert.equal(result.success, true);
  assert.equal(result.data.body.currency, 'NGN');
  assert.equal(result.data.body.variants[0].durationMinutes, 180);
});

test('service validation rejects a deposit equal to the full service price', () => {
  const result = createServiceSchema.safeParse({ body: { name: 'Makeup', basePriceMinor: 1000, currency: 'NGN', durationMinutes: 60, locationTypes: ['at_business'], paymentRule: 'deposit', depositAmountMinor: 1000 }, params: { businessId: objectId }, query: {} });
  assert.equal(result.success, false);
});

test('availability validation enforces unique weekdays and valid time ranges', () => {
  const result = upsertAvailabilitySchema.safeParse({ body: { weeklyRules: [{ dayOfWeek: 1, intervals: [{ start: '09:00', end: '17:00' }] }, { dayOfWeek: 1, intervals: [] }] }, params: { businessId: objectId }, query: {} });
  assert.equal(result.success, false);
  const valid = upsertAvailabilitySchema.safeParse({ body: { weeklyRules: [{ dayOfWeek: 1, intervals: [{ start: '09:00', end: '17:00' }] }] }, params: { businessId: objectId }, query: {} });
  assert.equal(valid.success, true);
});

test('availability converts business-local time to UTC without storing naive timestamps', () => {
  const utc = availabilityService.zonedDateTimeToUtc('2026-08-20', '09:00', 'Africa/Lagos');
  assert.equal(utc.toISOString(), '2026-08-20T08:00:00.000Z');
  const parts = availabilityService.getZonedParts(utc, 'Africa/Lagos');
  assert.deepEqual(parts, { year: 2026, month: 8, day: 20, hour: 9, minute: 0 });
});

test('booking locks cover the full occupied interval in five-minute buckets', () => {
  const locks = bookingService.lockBuckets(new Date('2026-08-20T08:00:00.000Z'), new Date('2026-08-20T09:30:00.000Z'));
  assert.equal(locks.length, 18);
  assert.equal(locks[0].toISOString(), '2026-08-20T08:00:00.000Z');
  assert.equal(locks.at(-1).toISOString(), '2026-08-20T09:25:00.000Z');
});

test('service and booking snapshots preserve historical appointment details', () => {
  const service = new Service({ _id: new mongoose.Types.ObjectId(), businessId, name: 'Hair Installation', slug: 'hair-installation', basePriceMinor: 1500000, currency: 'NGN', durationMinutes: 90, locationTypes: ['at_business'], variants: [{ name: 'Premium', priceMinor: 2500000, durationMinutes: 120 }] });
  const snapshot = service.toSnapshot(service.variants[0].variantId);
  assert.equal(snapshot.priceMinor, 2500000);
  assert.equal(snapshot.durationMinutes, 120);
  assert.equal(snapshot.cancellationWindowHours, 24);
  const booking = new Booking({ _id: new mongoose.Types.ObjectId(), bookingNumber: 'SCV-BKG-TEST-ABC123', customerId: new mongoose.Types.ObjectId(), businessId, serviceId: service._id, serviceSnapshot: snapshot, startAt: new Date('2026-08-20T08:00:00Z'), endAt: new Date('2026-08-20T10:00:00Z'), timezone: 'Africa/Lagos', priceMinor: snapshot.priceMinor, depositMinor: snapshot.priceMinor, currency: 'NGN' });
  assert.equal(booking.toSafeJSON().serviceSnapshot.serviceName, 'Hair Installation');
  assert.equal(booking.toSafeJSON().serviceSnapshot.priceMinor, 2500000);
});
