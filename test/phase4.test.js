const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { Service } = require('../src/modules/services/service.model');
const { createServiceSchema } = require('../src/modules/services/service.validation');
const { upsertAvailabilitySchema, availabilityQuerySchema } = require('../src/modules/availability/availability.validation');
const availabilityService = require('../src/modules/availability/availability.service');
const bookingService = require('../src/modules/bookings/booking.service');
const { createBookingSchema } = require('../src/modules/bookings/booking.validation');
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

test('availability validation supports staff and branch-scoped preferences', () => {
  const scoped = upsertAvailabilitySchema.safeParse({
    body: {
      staffUserId: objectId,
      locationId: objectId,
      timezone: 'Africa/Lagos',
      weeklyRules: [{ dayOfWeek: 2, enabled: true, intervals: [{ start: '10:00', end: '18:00' }] }]
    },
    params: { businessId: objectId },
    query: {}
  });
  assert.equal(scoped.success, true);
  assert.equal(scoped.data.body.staffUserId, objectId);
  assert.equal(scoped.data.body.locationId, objectId);
});

test('availability query supports a bounded ordered service bundle', () => {
  const secondServiceId = '507f1f77bcf86cd799439012';
  const valid = availabilityQuerySchema.safeParse({ body: {}, params: {}, query: { serviceId: objectId, serviceIds: `${objectId},${secondServiceId}`, from: '2026-08-20', to: '2026-08-27' } });
  assert.equal(valid.success, true);
  const tooMany = availabilityQuerySchema.safeParse({ body: {}, params: {}, query: { serviceId: objectId, serviceIds: [objectId, secondServiceId, '507f1f77bcf86cd799439013', '507f1f77bcf86cd799439014', '507f1f77bcf86cd799439015'].join(','), from: '2026-08-20', to: '2026-08-27' } });
  assert.equal(tooMany.success, false);
});

test('availability validation supports one dated exception per scoped rule', () => {
  const closed = upsertAvailabilitySchema.safeParse({
    body: { weeklyRules: [], overrides: [{ date: '2026-12-25', closed: true, note: 'Christmas closure' }] },
    params: { businessId: objectId }, query: {}
  });
  assert.equal(closed.success, true);

  const customHours = upsertAvailabilitySchema.safeParse({
    body: { weeklyRules: [], overrides: [{ date: '2026-12-31', intervals: [{ start: '10:00', end: '14:00' }], note: 'Short day' }] },
    params: { businessId: objectId }, query: {}
  });
  assert.equal(customHours.success, true);

  const duplicate = upsertAvailabilitySchema.safeParse({
    body: { weeklyRules: [], overrides: [{ date: '2026-12-31', closed: true }, { date: '2026-12-31', intervals: [{ start: '10:00', end: '14:00' }] }] },
    params: { businessId: objectId }, query: {}
  });
  assert.equal(duplicate.success, false);
});

test('dated availability exceptions take precedence over recurring hours', () => {
  const closed = availabilityService.intervalsForDate({ weeklyRules: [{ dayOfWeek: 5, enabled: true, intervals: [{ start: '09:00', end: '17:00' }] }], overrides: [{ date: '2026-12-25', closed: true, intervals: [] }] }, '2026-12-25');
  assert.deepEqual(closed, []);
  const custom = availabilityService.intervalsForDate({ weeklyRules: [{ dayOfWeek: 4, enabled: true, intervals: [{ start: '09:00', end: '17:00' }] }], overrides: [{ date: '2026-12-31', closed: false, intervals: [{ start: '10:00', end: '14:00' }] }] }, '2026-12-31');
  assert.deepEqual(custom, [{ start: '10:00', end: '14:00' }]);
});

test('branch closures and special hours are applied before professional availability', () => {
  const weeklyClosed = availabilityService.branchIntervalsForDate({ openingHours: [{ dayOfWeek: 5, closed: true, intervals: [{ start: '09:00', end: '17:00' }] }], specialHours: [] }, '2026-12-25');
  assert.deepEqual(weeklyClosed, []);
  const specialHours = availabilityService.branchIntervalsForDate({ openingHours: [{ dayOfWeek: 5, closed: false, intervals: [{ start: '09:00', end: '17:00' }] }], specialHours: [{ date: '2026-12-25', closed: false, intervals: [{ start: '11:00', end: '13:00' }] }] }, '2026-12-25');
  assert.deepEqual(specialHours, [{ start: '11:00', end: '13:00' }]);
  assert.equal(availabilityService.branchIntervalsForDate({ openingHours: [], specialHours: [] }, '2026-12-25'), null);
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

test('multi-service booking validation rejects duplicates and accepts ordered selections', () => {
  const secondServiceId = '507f1f77bcf86cd799439012';
  const base = { startAt: '2026-08-20T08:00:00.000Z', locationType: 'at_business', locationId: objectId, requestType: 'request' };
  const valid = createBookingSchema.safeParse({ body: { ...base, services: [{ serviceId: objectId }, { serviceId: secondServiceId }] }, params: {}, query: {} });
  assert.equal(valid.success, true);
  const duplicate = createBookingSchema.safeParse({ body: { ...base, services: [{ serviceId: objectId }, { serviceId: objectId }] }, params: {}, query: {} });
  assert.equal(duplicate.success, false);
});

test('bundle timing includes inter-service buffers and exposes outer buffers', () => {
  const result = bookingService.bundleTiming([
    { snapshot: { durationMinutes: 60, bufferBeforeMinutes: 10, bufferAfterMinutes: 5 } },
    { snapshot: { durationMinutes: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 10 } }
  ]);
  assert.deepEqual(result, { durationMinutes: 100, bufferBeforeMinutes: 10, bufferAfterMinutes: 10 });
  const bookingResult = bookingService.bookingTiming({ serviceItems: [{ ...result, serviceId: new mongoose.Types.ObjectId(), serviceName: 'First', priceMinor: 1, durationMinutes: 60, bufferBeforeMinutes: 10, bufferAfterMinutes: 5, cancellationWindowHours: 24, currency: 'NGN', businessId }, { serviceId: new mongoose.Types.ObjectId(), serviceName: 'Second', priceMinor: 1, durationMinutes: 30, bufferBeforeMinutes: 5, bufferAfterMinutes: 10, cancellationWindowHours: 48, currency: 'NGN', businessId }] });
  assert.equal(bookingResult.timing.durationMinutes, 100);
  assert.equal(bookingResult.timing.bufferBeforeMinutes, 10);
  assert.equal(bookingResult.timing.bufferAfterMinutes, 10);
});

test('service and booking snapshots preserve historical appointment details', () => {
  const service = new Service({ _id: new mongoose.Types.ObjectId(), businessId, name: 'Hair Installation', slug: 'hair-installation', basePriceMinor: 1500000, currency: 'NGN', durationMinutes: 90, locationTypes: ['at_business'], variants: [{ name: 'Premium', priceMinor: 2500000, durationMinutes: 120 }] });
  const snapshot = service.toSnapshot(service.variants[0].variantId);
  assert.equal(snapshot.priceMinor, 2500000);
  assert.equal(snapshot.durationMinutes, 120);
  assert.equal(snapshot.cancellationWindowHours, 24);
  const booking = new Booking({ _id: new mongoose.Types.ObjectId(), bookingNumber: 'SCV-BKG-TEST-ABC123', customerId: new mongoose.Types.ObjectId(), businessId, serviceId: service._id, serviceSnapshot: snapshot, serviceItems: [snapshot, { ...snapshot, serviceName: 'Hair Styling', durationMinutes: 60 }], totalDurationMinutes: 180, startAt: new Date('2026-08-20T08:00:00Z'), endAt: new Date('2026-08-20T10:00:00Z'), timezone: 'Africa/Lagos', priceMinor: snapshot.priceMinor, depositMinor: snapshot.priceMinor, currency: 'NGN' });
  assert.equal(booking.toSafeJSON().serviceSnapshot.serviceName, 'Hair Installation');
  assert.equal(booking.toSafeJSON().serviceSnapshot.priceMinor, 2500000);
  assert.equal(booking.toSafeJSON().serviceItems.length, 2);
  assert.equal(booking.toSafeJSON().totalDurationMinutes, 180);
});
