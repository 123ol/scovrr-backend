const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { Address } = require('../addresses/address.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Service } = require('../services/service.model');
const { Booking, ACTIVE_BOOKING_STATUSES } = require('./booking.model');
const { BookingSlotLock } = require('./booking-slot-lock.model');
const availabilityService = require('../availability/availability.service');
const promotionService = require('../promotions/promotion.service');

function bookingNumber() { return `SCV-BKG-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

function addressSnapshot(address) {
  if (!address) return null;
  const snapshot = address.toObject();
  delete snapshot._id; delete snapshot.userId; delete snapshot.createdAt; delete snapshot.updatedAt;
  return snapshot;
}

function lockBuckets(startAt, endAt) {
  const bucketMs = 5 * 60_000;
  const first = Math.floor(new Date(startAt).getTime() / bucketMs) * bucketMs;
  const last = Math.ceil(new Date(endAt).getTime() / bucketMs) * bucketMs;
  const buckets = [];
  for (let value = first; value < last; value += bucketMs) buckets.push(new Date(value));
  return buckets;
}

async function releaseBookingLocks(bookingId) { await BookingSlotLock.deleteMany({ bookingId }); }

async function claimBookingLocks({ bookingId, businessId, locationId = null, staffUserId, startAt, endAt, expiresAt }) {
  await BookingSlotLock.deleteMany({ expiresAt: { $lte: new Date() } });
  const resourceKey = staffUserId ? `staff:${staffUserId}` : `business:${businessId}:location:${locationId || 'global'}`;
  const locks = lockBuckets(startAt, endAt).map((bucketStart) => ({ bookingId, businessId, locationId: locationId || null, staffUserId: staffUserId || null, resourceKey, bucketStart, expiresAt }));
  try {
    await BookingSlotLock.insertMany(locks, { ordered: true });
  } catch (error) {
    await releaseBookingLocks(bookingId);
    if (error?.code === 11000) throw new AppError(409, 'BOOKING_SLOT_UNAVAILABLE', 'This time was reserved by another customer');
    throw error;
  }
  return resourceKey;
}

async function expireBookingHolds() {
  const expired = await Booking.find({ status: { $in: ['pending_payment', 'requested'] }, holdExpiresAt: { $lte: new Date() } }).select('_id status');
  for (const booking of expired) {
    booking.status = booking.status === 'requested' ? 'rejected' : 'cancelled_by_business';
    booking.timeline.push({ status: booking.status, actorId: null, note: 'Booking hold expired before confirmation.' });
    await booking.save();
    await releaseBookingLocks(booking._id);
    await promotionService.releasePromotionForBooking(booking._id);
  }
  return expired.length;
}

async function getBookableService(serviceId) {
  const service = await Service.findOne({ _id: serviceId, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!service || !service.businessId || service.businessId.status !== 'active' || service.businessId.moderationStatus !== 'approved') throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found');
  return service;
}

async function resolveBookingContext(userId, input) {
  const service = await getBookableService(input.serviceId);
  const variant = input.variantId ? service.variants.find((item) => item.variantId.toString() === input.variantId && item.active) : null;
  if (input.variantId && !variant) throw new AppError(409, 'SERVICE_VARIANT_UNAVAILABLE', 'The selected service variant is unavailable');
  if (!input.variantId && service.variants.length > 0) throw new AppError(409, 'SERVICE_VARIANT_REQUIRED', 'Choose a service option before booking');
  if (!service.locationTypes.includes(input.locationType)) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', 'This service does not support the selected location type');
  if (input.staffUserId && !service.staffUserIds.some((staffId) => staffId.toString() === input.staffUserId)) throw new AppError(409, 'SERVICE_STAFF_UNAVAILABLE', 'The selected professional is not assigned to this service');

  let location = null;
  if (input.locationId) {
    location = await BusinessLocation.findOne({ _id: input.locationId, businessId: service.businessId._id, active: true });
    if (!location) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'The selected business location is unavailable');
  }
  if (input.locationType === 'at_business' && !location) throw new AppError(400, 'BUSINESS_LOCATION_REQUIRED', 'Choose a business location for this appointment');
  if (location && service.locationIds.length && !service.locationIds.some((id) => id.toString() === location._id.toString())) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', 'This service is not offered at the selected branch');
  const eligibleStaff = service.staffUserIds.filter((staffId) => {
    const assignment = service.staffAssignments.find((item) => item.staffUserId.toString() === staffId.toString());
    return !assignment || !assignment.locationIds.length || !location || assignment.locationIds.some((id) => id.toString() === location._id.toString());
  });
  if (input.staffUserId && !eligibleStaff.some((staffId) => staffId.toString() === input.staffUserId)) throw new AppError(409, 'SERVICE_STAFF_UNAVAILABLE', 'The selected professional is not assigned to this location');
  let address = null;
  if (['at_customer', 'mobile'].includes(input.locationType)) {
    address = await Address.findOne({ _id: input.addressId, userId });
    if (!address) throw new AppError(400, 'SERVICE_ADDRESS_REQUIRED', 'Choose a saved address for this mobile service');
  }
  const candidates = input.staffUserId ? [input.staffUserId] : eligibleStaff.map((id) => id.toString());
  const snapshot = service.toSnapshot(variant?.variantId || null);
  const durationMinutes = snapshot.durationMinutes;
  const endAt = new Date(new Date(input.startAt).getTime() + durationMinutes * 60_000);
  let assignedStaffUserId = input.staffUserId || null;
  let rule = await availabilityService.getAvailabilityRule(service.businessId._id, assignedStaffUserId, location?._id || null);
  if (!assignedStaffUserId && candidates.length) {
    for (const candidate of candidates.sort()) {
      try {
        rule = await availabilityService.getAvailabilityRule(service.businessId._id, candidate, location?._id || null);
        await availabilityService.assertSlotAvailable({ businessId: service.businessId._id, locationId: location?._id || null, staffUserId: candidate, startAt: new Date(input.startAt), durationMinutes, bufferBeforeMinutes: snapshot.bufferBeforeMinutes, bufferAfterMinutes: snapshot.bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes: service.minNoticeMinutes, maxAdvanceDays: service.maxAdvanceDays });
        assignedStaffUserId = candidate;
        break;
      } catch (error) {
        if (!(error instanceof AppError) || !['BOOKING_SLOT_UNAVAILABLE', 'BOOKING_OUTSIDE_AVAILABILITY', 'BOOKING_MINIMUM_NOTICE', 'BOOKING_TOO_FAR_AHEAD', 'LOCATION_CLOSED'].includes(error.code)) throw error;
      }
    }
    if (!assignedStaffUserId) throw new AppError(409, 'BOOKING_SLOT_UNAVAILABLE', 'No eligible professional is available at this time');
  } else {
    await availabilityService.assertSlotAvailable({ businessId: service.businessId._id, locationId: location?._id || null, staffUserId: assignedStaffUserId, startAt: new Date(input.startAt), durationMinutes, bufferBeforeMinutes: snapshot.bufferBeforeMinutes, bufferAfterMinutes: snapshot.bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes: service.minNoticeMinutes, maxAdvanceDays: service.maxAdvanceDays });
  }
  return { service, variant, location, address, rule, snapshot, endAt, staffUserId: assignedStaffUserId };
}

async function createBooking(userId, input) {
  const { assertUserCanActById } = require('../users/user-status.service');
  await assertUserCanActById(userId);
  await expireBookingHolds();
  if (input.clientRequestId) {
    const existing = await Booking.findOne({ clientRequestId: input.clientRequestId, customerId: userId });
    if (existing) return existing;
  }
  const context = await resolveBookingContext(userId, input);
  const pricing = await promotionService.calculatePricing({ businessId: context.service.businessId._id, customerId: userId, code: input.couponCode, currency: context.snapshot.currency, subtotalMinor: context.snapshot.priceMinor, lines: [{ type: 'service', serviceId: context.service._id, variantId: context.snapshot.variantId, categoryId: context.service.categoryId || null, businessId: context.service.businessId._id, lineTotalMinor: context.snapshot.priceMinor }], kind: 'booking', locationId: context.location?._id || null });
  const bookingId = new mongoose.Types.ObjectId();
  const startAt = new Date(input.startAt);
  const holdExpiresAt = new Date(Date.now() + (input.requestType === 'instant' ? 15 : 24 * 60) * 60_000);
  await claimBookingLocks({ bookingId, businessId: context.service.businessId._id, locationId: context.location?._id || null, staffUserId: context.staffUserId, startAt: new Date(startAt.getTime() - context.snapshot.bufferBeforeMinutes * 60_000), endAt: new Date(context.endAt.getTime() + context.snapshot.bufferAfterMinutes * 60_000), expiresAt: holdExpiresAt });
  try {
    const priceMinor = pricing.totalBeforeDeliveryMinor;
    const depositMinor = context.service.paymentRule === 'deposit' ? Math.min(context.service.depositAmountMinor, priceMinor) : priceMinor;
    const booking = await Booking.create({ _id: bookingId, bookingNumber: bookingNumber(), clientRequestId: input.clientRequestId, customerId: userId, businessId: context.service.businessId._id, serviceId: context.service._id, serviceSnapshot: context.snapshot, staffUserId: context.staffUserId, locationType: input.locationType, locationId: context.location?._id || null, addressSnapshot: addressSnapshot(context.address), startAt, endAt: context.endAt, timezone: context.rule.timezone, customerNotes: input.customerNotes || '', priceMinor, depositMinor, discountMinor: pricing.discountMinor, couponCode: input.couponCode || null, pricingSnapshot: pricing, currency: context.snapshot.currency, requestType: input.requestType, paymentStatus: 'not_initialized', status: input.requestType === 'instant' ? 'pending_payment' : 'requested', holdExpiresAt, timeline: [{ status: input.requestType === 'instant' ? 'pending_payment' : 'requested', actorId: userId, note: input.requestType === 'instant' ? 'Appointment reserved pending payment initialization.' : 'Booking request submitted to the business.' }] });
    for (const plan of pricing.redemptionPlans || []) await promotionService.reservePromotion({ promotionId: plan.promotionId, couponCodeId: plan.couponCodeId, discountMinor: plan.discountMinor, bookingId: booking._id, customerId: userId, idempotencyKey: `booking:${booking._id}:promotion:${plan.promotionId}` });
    await require('../analytics/domain-event.service').queue('BOOKING_CREATED', { userId, actorType: 'user', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString(), amountMinor: booking.depositMinor, currency: booking.currency, requestType: booking.requestType } }, `booking:${booking._id}:created`);
    return booking;
  } catch (error) {
    await releaseBookingLocks(bookingId);
    await promotionService.releasePromotionForBooking(bookingId);
    if (error?.code === 11000 && input.clientRequestId) return Booking.findOne({ clientRequestId: input.clientRequestId, customerId: userId });
    throw error;
  }
}

async function listCustomerBookings(userId, query) {
  const filter = { customerId: userId }; if (query.status) filter.status = query.status; if (query.from || query.to) filter.startAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lt: new Date(query.to) } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [bookings, total] = await Promise.all([Booking.find(filter).sort({ startAt: 1 }).skip(skip).limit(query.limit), Booking.countDocuments(filter)]);
  return { bookings: bookings.map((booking) => ({ ...booking.toSafeJSON(), customerId: booking.customerId.toString() })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getCustomerBooking(userId, bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, customerId: userId }); if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found'); return booking;
}

async function listBusinessBookings(businessId, query, membership = null) {
  const filter = { businessId }; const allowedLocations = membership?.locationAccess?.mode === 'selected' ? membership.locationAccess.locationIds : null;
  if (query.locationId) { if (allowedLocations && !allowedLocations.some((id) => id.toString() === query.locationId.toString())) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'You do not have access to this branch'); filter.locationId = query.locationId; } else if (allowedLocations) filter.locationId = { $in: allowedLocations };
  if (query.status) filter.status = query.status; if (query.from || query.to) filter.startAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lt: new Date(query.to) } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [bookings, total] = await Promise.all([Booking.find(filter).sort({ startAt: 1 }).skip(skip).limit(query.limit), Booking.countDocuments(filter)]);
  return { bookings: bookings.map((booking) => ({ ...booking.toSafeJSON(), customerId: booking.customerId.toString() })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getBusinessBooking(businessId, bookingId, membership = null) { const booking = await Booking.findOne({ _id: bookingId, businessId }); if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found'); if (membership?.locationAccess?.mode === 'selected' && (!booking.locationId || !membership.locationAccess.locationIds.some((id) => id.toString() === booking.locationId.toString()))) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found'); return booking; }

async function updateLockExpiry(bookingId, expiresAt) { await BookingSlotLock.updateMany({ bookingId }, { $set: { expiresAt } }); }

async function transitionBusinessBooking(businessId, bookingId, actorId, action, reason, membership = null) {
  await expireBookingHolds();
  const booking = await getBusinessBooking(businessId, bookingId, membership);
  const next = { accept: ['requested', 'confirmed'], reject: ['requested', 'rejected'], confirm: ['pending_payment', 'confirmed'], check_in: ['confirmed', 'checked_in'], start: ['checked_in', 'in_progress'], complete: ['in_progress', 'completed'], no_show: ['confirmed', 'no_show'], cancel: [...ACTIVE_BOOKING_STATUSES, 'rejected'] };
  const target = { accept: 'confirmed', reject: 'rejected', confirm: 'confirmed', check_in: 'checked_in', start: 'in_progress', complete: 'completed', no_show: 'no_show', cancel: 'cancelled_by_business' }[action];
  if (!next[action]?.includes(booking.status)) throw new AppError(409, 'BOOKING_TRANSITION_NOT_ALLOWED', `Cannot ${action} a booking in its current state`);
  booking.status = target; booking.timeline.push({ status: target, actorId, note: reason || `Business ${action}ed booking.` });
  if (['confirmed', 'checked_in', 'in_progress'].includes(target)) { booking.holdExpiresAt = null; await updateLockExpiry(booking._id, booking.endAt); }
  if (['rejected', 'cancelled_by_business', 'no_show', 'completed'].includes(target)) await releaseBookingLocks(booking._id);
  await booking.save();
  const eventName = target === 'confirmed' ? 'BOOKING_CONFIRMED' : target === 'completed' ? 'BOOKING_COMPLETED' : ['cancelled_by_business', 'no_show', 'rejected'].includes(target) ? 'BOOKING_CANCELLED' : null;
  if (eventName) await require('../analytics/domain-event.service').queue(eventName, { actorId, actorType: 'user', businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString(), amountMinor: booking.depositMinor, currency: booking.currency, status: target, reason: reason || null } }, `booking:${booking._id}:${eventName.toLowerCase()}`);
  return booking;
}

async function cancelCustomerBooking(userId, bookingId, reason) {
  const booking = await getCustomerBooking(userId, bookingId);
  if (!['pending_payment', 'requested', 'confirmed', 'upcoming'].includes(booking.status)) throw new AppError(409, 'BOOKING_CANCELLATION_NOT_AVAILABLE', 'This booking cannot be cancelled in its current state');
  if (booking.startAt.getTime() - Date.now() < booking.serviceSnapshot.cancellationWindowHours * 60 * 60_000) throw new AppError(409, 'BOOKING_CANCELLATION_WINDOW_PASSED', 'This booking is inside the cancellation window');
  booking.status = 'cancelled_by_customer'; booking.cancellation = { reason: reason || 'Customer cancelled booking', cancelledBy: userId, cancelledAt: new Date() }; booking.timeline.push({ status: booking.status, actorId: userId, note: booking.cancellation.reason });
  await releaseBookingLocks(booking._id); await promotionService.releasePromotionForBooking(booking._id); await booking.save(); await require('../analytics/domain-event.service').queue('BOOKING_CANCELLED', { userId, actorType: 'user', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), amountMinor: booking.depositMinor, currency: booking.currency, reason: booking.cancellation.reason } }, `booking:${booking._id}:cancelled`); return booking;
}

async function rescheduleBooking({ booking, actorId, newStartAt, reason }) {
  if (!['requested', 'confirmed', 'upcoming'].includes(booking.status)) throw new AppError(409, 'BOOKING_RESCHEDULE_NOT_AVAILABLE', 'This booking cannot be rescheduled in its current state');
  const oldStartAt = booking.startAt; const oldEndAt = booking.endAt;
  await releaseBookingLocks(booking._id);
  try {
    const service = await Service.findById(booking.serviceId);
    const rule = await availabilityService.getAvailabilityRule(booking.businessId, booking.staffUserId, booking.locationId);
    const durationMinutes = booking.serviceSnapshot.durationMinutes;
    await availabilityService.assertSlotAvailable({ businessId: booking.businessId, locationId: booking.locationId, staffUserId: booking.staffUserId, startAt: new Date(newStartAt), durationMinutes, bufferBeforeMinutes: booking.serviceSnapshot.bufferBeforeMinutes, bufferAfterMinutes: booking.serviceSnapshot.bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes: service?.minNoticeMinutes || 0, maxAdvanceDays: service?.maxAdvanceDays || 730, excludeBookingId: booking._id });
    const newEndAt = new Date(new Date(newStartAt).getTime() + durationMinutes * 60_000);
    await claimBookingLocks({ bookingId: booking._id, businessId: booking.businessId, locationId: booking.locationId, staffUserId: booking.staffUserId, startAt: new Date(new Date(newStartAt).getTime() - booking.serviceSnapshot.bufferBeforeMinutes * 60_000), endAt: new Date(newEndAt.getTime() + booking.serviceSnapshot.bufferAfterMinutes * 60_000), expiresAt: booking.holdExpiresAt || newEndAt });
    booking.startAt = new Date(newStartAt); booking.endAt = newEndAt; booking.timezone = rule.timezone; booking.rescheduleHistory.push({ oldStartAt, oldEndAt, newStartAt: booking.startAt, newEndAt, requestedBy: actorId, reason: reason || '' }); booking.timeline.push({ status: 'rescheduled', actorId, note: reason || 'Booking time changed.' });
    await booking.save(); return booking;
  } catch (error) {
    await releaseBookingLocks(booking._id);
    try { await claimBookingLocks({ bookingId: booking._id, businessId: booking.businessId, locationId: booking.locationId, staffUserId: booking.staffUserId, startAt: new Date(oldStartAt.getTime() - booking.serviceSnapshot.bufferBeforeMinutes * 60_000), endAt: new Date(oldEndAt.getTime() + booking.serviceSnapshot.bufferAfterMinutes * 60_000), expiresAt: booking.holdExpiresAt || oldEndAt }); } catch (_restoreError) { /* original booking remains persisted; reconciliation can repair locks */ }
    throw error;
  }
}

module.exports = { bookingNumber, lockBuckets, claimBookingLocks, releaseBookingLocks, expireBookingHolds, createBooking, listCustomerBookings, getCustomerBooking, listBusinessBookings, getBusinessBooking, transitionBusinessBooking, cancelCustomerBooking, rescheduleBooking, resolveBookingContext };
