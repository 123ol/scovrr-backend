const assert = require('node:assert/strict');
const { test } = require('node:test');
const { reminderWindows, getRebookingOptions, getRecurringBookingOptions, bookingFollowUpDeduplicationKey } = require('../src/modules/bookings/booking.service');
const waitlistService = require('../src/modules/bookings/booking-waitlist.service');
const { Booking } = require('../src/modules/bookings/booking.model');
const { BookingWaitlist } = require('../src/modules/bookings/booking-waitlist.model');

test('booking reminders use bounded one-hour and one-day windows', () => {
  const now = new Date('2026-10-17T10:00:00.000Z');
  const windows = reminderWindows(now);
  assert.deepEqual(windows.map((window) => window.key), ['24h', '1h']);
  assert.equal(windows[0].to.getTime() - windows[0].from.getTime(), 2 * 60 * 60_000);
  assert.equal(windows[1].to.getTime() - windows[1].from.getTime(), 10 * 60_000);
});

test('booking model preserves reminder-compatible confirmed states', () => {
  assert.ok(Booking.schema.path('status').enumValues.includes('confirmed'));
  assert.ok(Booking.schema.path('startAt'));
  assert.ok(Booking.schema.path('timezone'));
});

test('waitlist model is scoped to customer, service, and actionable states', () => {
  assert.ok(BookingWaitlist.schema.path('customerId'));
  assert.ok(BookingWaitlist.schema.path('serviceId'));
  assert.ok(BookingWaitlist.schema.path('preferredStartAt'));
  assert.deepEqual(BookingWaitlist.schema.path('status').enumValues, ['waiting', 'offered', 'accepting', 'converted', 'cancelled', 'expired']);
  assert.ok(BookingWaitlist.schema.path('offeredStartAt'));
  assert.equal(typeof waitlistService.acceptWaitlistOffer, 'function');
  assert.equal(typeof waitlistService.expireWaitlistOffers, 'function');
  const now = new Date('2026-10-17T12:00:00.000Z');
  assert.equal(waitlistService.staleAcceptingStatus({ offerExpiresAt: new Date('2026-10-17T11:00:00.000Z') }, null, now), 'expired');
  assert.equal(waitlistService.staleAcceptingStatus({ offerExpiresAt: new Date('2026-10-17T13:00:00.000Z') }, null, now), 'offered');
  assert.equal(waitlistService.staleAcceptingStatus({ offerExpiresAt: new Date('2026-10-17T13:00:00.000Z') }, { _id: new (require('mongoose').Types.ObjectId)() }, now), 'converted');
});

test('waitlist safe JSON keeps listing labels additive and private', () => {
  const customerId = new (require('mongoose').Types.ObjectId)();
  const serviceId = new (require('mongoose').Types.ObjectId)();
  const businessId = new (require('mongoose').Types.ObjectId)();
  const item = new BookingWaitlist({ customerId, serviceId, businessId, locationType: 'at_business' });
  const safe = item.toSafeJSON();
  assert.equal(safe.customerId, customerId.toString());
  assert.equal(safe.serviceId, serviceId.toString());
  assert.equal(safe.business, null);
  assert.equal(safe.service, null);
  assert.equal('adminNotes' in safe, false);
});

test('completed booking contracts expose a safe rebooking boundary and follow-up fields', () => {
  assert.equal(typeof getRebookingOptions, 'function');
  assert.ok(Booking.schema.path('serviceSnapshot'));
  assert.ok(Booking.schema.path('serviceItems'));
  assert.ok(Booking.schema.path('totalDurationMinutes'));
  assert.ok(Booking.schema.path('locationType'));
  assert.equal(typeof getRecurringBookingOptions, 'function');
  assert.equal(bookingFollowUpDeduplicationKey('booking-123'), 'booking-follow-up:booking-123');
});
