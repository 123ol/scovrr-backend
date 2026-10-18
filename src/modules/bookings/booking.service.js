const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { Address } = require('../addresses/address.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Service } = require('../services/service.model');
const { Booking, ACTIVE_BOOKING_STATUSES } = require('./booking.model');
const { BookingSlotLock } = require('./booking-slot-lock.model');
const waitlistService = require('./booking-waitlist.service');
const availabilityService = require('../availability/availability.service');
const promotionService = require('../promotions/promotion.service');
const notificationService = require('../notifications/notification.service');
const { BusinessMembership } = require('../businesses/business-membership.model');

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
    await waitlistService.offerForReleasedBooking(booking);
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

function normalizeServiceSelections(input) {
  const selections = input.services?.length ? input.services : [{ serviceId: input.serviceId, variantId: input.variantId }];
  const unique = new Map(selections.map((selection) => [selection.serviceId.toString(), selection]));
  if (unique.size !== selections.length) throw new AppError(400, 'DUPLICATE_BOOKING_SERVICE', 'Each service may only be selected once');
  if (unique.size > 4) throw new AppError(400, 'TOO_MANY_BOOKING_SERVICES', 'An appointment can include at most four services');
  return [...unique.values()];
}

function bundleTiming(items) {
  const first = items[0]?.snapshot;
  const last = items[items.length - 1]?.snapshot;
  if (!first || !last) throw new AppError(400, 'BOOKING_SERVICE_REQUIRED', 'Choose at least one service');
  const durationMinutes = items.reduce((total, item, index) => total + item.snapshot.durationMinutes + (index > 0 ? item.snapshot.bufferBeforeMinutes : 0) + (index < items.length - 1 ? item.snapshot.bufferAfterMinutes : 0), 0);
  return { durationMinutes, bufferBeforeMinutes: first.bufferBeforeMinutes, bufferAfterMinutes: last.bufferAfterMinutes };
}

function bookingServiceItems(booking) {
  return booking.serviceItems?.length ? [...booking.serviceItems] : [booking.serviceSnapshot];
}

function bookingTiming(booking) {
  const snapshots = bookingServiceItems(booking);
  return { snapshots, timing: bundleTiming(snapshots.map((snapshot) => ({ snapshot }))) };
}

function commonStaffIds(items) {
  const constrained = items.map((item) => item.eligibleStaff).filter((ids) => ids.length);
  if (!constrained.length) return [];
  return constrained.slice(1).reduce((common, ids) => common.filter((id) => ids.includes(id)), [...constrained[0]]);
}

async function resolveBundleBookingContext(userId, input) {
  const selections = normalizeServiceSelections(input);
  if (selections.length === 1) return resolveBookingContext(userId, { ...input, serviceId: selections[0].serviceId, variantId: selections[0].variantId, services: undefined });
  const items = [];
  let businessId = null;
  let location = null;
  let address = null;
  for (const selection of selections) {
    const service = await getBookableService(selection.serviceId);
    const serviceBusinessId = service.businessId._id.toString();
    if (businessId && businessId !== serviceBusinessId) throw new AppError(409, 'BOOKING_BUSINESS_MISMATCH', 'All appointment services must belong to the same business');
    businessId = serviceBusinessId;
    const variant = selection.variantId ? service.variants.find((item) => item.variantId.toString() === selection.variantId && item.active) : null;
    if (selection.variantId && !variant) throw new AppError(409, 'SERVICE_VARIANT_UNAVAILABLE', 'The selected service variant is unavailable');
    if (!selection.variantId && service.variants.length > 0) throw new AppError(409, 'SERVICE_VARIANT_REQUIRED', `Choose an option for ${service.name}`);
    if (!service.locationTypes.includes(input.locationType)) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', `${service.name} does not support the selected location type`);
    if (input.staffUserId && !service.staffUserIds.some((staffId) => staffId.toString() === input.staffUserId)) throw new AppError(409, 'SERVICE_STAFF_UNAVAILABLE', `The selected professional is not assigned to ${service.name}`);
    if (input.locationId) {
      location = location || await BusinessLocation.findOne({ _id: input.locationId, businessId: service.businessId._id, active: true });
      if (!location) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'The selected business location is unavailable');
    }
    if (input.locationType === 'at_business' && !location) throw new AppError(400, 'BUSINESS_LOCATION_REQUIRED', 'Choose a business location for this appointment');
    if (location && service.locationIds.length && !service.locationIds.some((id) => id.toString() === location._id.toString())) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', `${service.name} is not offered at the selected branch`);
    if (['at_customer', 'mobile'].includes(input.locationType)) {
      address = address || await Address.findOne({ _id: input.addressId, userId });
      if (!address) throw new AppError(400, 'SERVICE_ADDRESS_REQUIRED', 'Choose a saved address for this mobile service');
    }
    const eligibleStaff = service.staffUserIds.filter((staffId) => {
      const assignment = service.staffAssignments.find((item) => item.staffUserId.toString() === staffId.toString());
      return !assignment || !assignment.locationIds.length || !location || assignment.locationIds.some((id) => id.toString() === location._id.toString());
    }).map((staffId) => staffId.toString());
    if (input.staffUserId && !eligibleStaff.includes(input.staffUserId)) throw new AppError(409, 'SERVICE_STAFF_UNAVAILABLE', `The selected professional is not assigned to ${service.name} at this location`);
    const snapshot = service.toSnapshot(variant?.variantId || null);
    items.push({ service, variant, snapshot, eligibleStaff });
  }
  const timing = bundleTiming(items);
  const currencies = new Set(items.map((item) => item.snapshot.currency));
  if (currencies.size !== 1) throw new AppError(409, 'BOOKING_CURRENCY_MISMATCH', 'All appointment services must use the same currency');
  const minNoticeMinutes = Math.max(...items.map((item) => item.service.minNoticeMinutes || 0));
  const maxAdvanceDays = Math.min(...items.map((item) => item.service.maxAdvanceDays || 730));
  const constrainedStaff = items.map((item) => item.eligibleStaff).filter((ids) => ids.length);
  const candidateStaff = input.staffUserId ? [input.staffUserId] : commonStaffIds(items);
  if (!input.staffUserId && constrainedStaff.length && !candidateStaff.length) throw new AppError(409, 'SERVICE_STAFF_UNAVAILABLE', 'No professional is assigned to every selected service');
  const candidates = candidateStaff.length ? [...candidateStaff].sort() : [null];
  let assignedStaffUserId = input.staffUserId || null;
  let rule = await availabilityService.getAvailabilityRule(businessId, assignedStaffUserId, location?._id || null);
  for (const candidate of candidates) {
    try {
      rule = await availabilityService.getAvailabilityRule(businessId, candidate, location?._id || null);
      await availabilityService.assertSlotAvailable({ businessId, locationId: location?._id || null, staffUserId: candidate, startAt: new Date(input.startAt), durationMinutes: timing.durationMinutes, bufferBeforeMinutes: timing.bufferBeforeMinutes, bufferAfterMinutes: timing.bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes, maxAdvanceDays });
      assignedStaffUserId = candidate;
      break;
    } catch (error) {
      if (!(error instanceof AppError) || !['BOOKING_SLOT_UNAVAILABLE', 'BOOKING_OUTSIDE_AVAILABILITY', 'BOOKING_MINIMUM_NOTICE', 'BOOKING_TOO_FAR_AHEAD', 'LOCATION_CLOSED'].includes(error.code)) throw error;
      assignedStaffUserId = null;
    }
  }
  if (assignedStaffUserId === null && input.staffUserId) throw new AppError(409, 'BOOKING_SLOT_UNAVAILABLE', 'The selected professional is not available for the full appointment');
  if (!assignedStaffUserId && candidateStaff.length) throw new AppError(409, 'BOOKING_SLOT_UNAVAILABLE', 'No eligible professional is available for the full appointment');
  if (!assignedStaffUserId && !candidateStaff.length) {
    await availabilityService.assertSlotAvailable({ businessId, locationId: location?._id || null, staffUserId: null, startAt: new Date(input.startAt), durationMinutes: timing.durationMinutes, bufferBeforeMinutes: timing.bufferBeforeMinutes, bufferAfterMinutes: timing.bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes, maxAdvanceDays });
  }
  const startAt = new Date(input.startAt);
  return { service: items[0].service, variant: items[0].variant, location, address, rule, snapshot: items[0].snapshot, endAt: new Date(startAt.getTime() + timing.durationMinutes * 60_000), staffUserId: assignedStaffUserId, items, totalDurationMinutes: timing.durationMinutes, timing };
}

async function createBooking(userId, input) {
  const { assertUserCanActById } = require('../users/user-status.service');
  await assertUserCanActById(userId);
  await expireBookingHolds();
  if (input.clientRequestId) {
    const existing = await Booking.findOne({ clientRequestId: input.clientRequestId, customerId: userId });
    if (existing) return existing;
  }
  const context = input.services?.length > 1 ? await resolveBundleBookingContext(userId, input) : await resolveBookingContext(userId, input);
  const items = context.items || [{ service: context.service, variant: context.variant, snapshot: context.snapshot }];
  const subtotalMinor = items.reduce((sum, item) => sum + item.snapshot.priceMinor, 0);
  const pricing = await promotionService.calculatePricing({ businessId: context.service.businessId._id, customerId: userId, code: input.couponCode, currency: context.snapshot.currency, subtotalMinor, lines: items.map((item) => ({ type: 'service', serviceId: item.service._id, variantId: item.snapshot.variantId, categoryId: item.service.categoryId || null, businessId: item.service.businessId._id, lineTotalMinor: item.snapshot.priceMinor })), kind: 'booking', locationId: context.location?._id || null });
  const bookingId = new mongoose.Types.ObjectId();
  const startAt = new Date(input.startAt);
  const holdExpiresAt = new Date(Date.now() + (input.requestType === 'instant' ? 15 : 24 * 60) * 60_000);
  const lockTiming = context.timing || context.snapshot;
  await claimBookingLocks({ bookingId, businessId: context.service.businessId._id, locationId: context.location?._id || null, staffUserId: context.staffUserId, startAt: new Date(startAt.getTime() - lockTiming.bufferBeforeMinutes * 60_000), endAt: new Date(context.endAt.getTime() + lockTiming.bufferAfterMinutes * 60_000), expiresAt: holdExpiresAt });
  try {
    const priceMinor = pricing.totalBeforeDeliveryMinor;
    const depositMinor = items.reduce((sum, item) => sum + (item.service.paymentRule === 'deposit' ? Math.min(item.service.depositAmountMinor, item.snapshot.priceMinor) : item.snapshot.priceMinor), 0);
    const booking = await Booking.create({ _id: bookingId, bookingNumber: bookingNumber(), clientRequestId: input.clientRequestId, customerId: userId, businessId: context.service.businessId._id, serviceId: context.service._id, serviceSnapshot: context.snapshot, serviceItems: items.map((item) => item.snapshot), totalDurationMinutes: context.totalDurationMinutes || context.snapshot.durationMinutes, staffUserId: context.staffUserId, locationType: input.locationType, locationId: context.location?._id || null, addressSnapshot: addressSnapshot(context.address), startAt, endAt: context.endAt, timezone: context.rule.timezone, customerNotes: input.customerNotes || '', priceMinor, depositMinor, discountMinor: pricing.discountMinor, couponCode: input.couponCode || null, pricingSnapshot: pricing, currency: context.snapshot.currency, requestType: input.requestType, paymentStatus: 'not_initialized', status: input.requestType === 'instant' ? 'pending_payment' : 'requested', holdExpiresAt, timeline: [{ status: input.requestType === 'instant' ? 'pending_payment' : 'requested', actorId: userId, note: input.requestType === 'instant' ? 'Appointment reserved pending payment initialization.' : 'Booking request submitted to the business.' }] });
    for (const plan of pricing.redemptionPlans || []) await promotionService.reservePromotion({ promotionId: plan.promotionId, couponCodeId: plan.couponCodeId, discountMinor: plan.discountMinor, bookingId: booking._id, customerId: userId, idempotencyKey: `booking:${booking._id}:promotion:${plan.promotionId}` });
    await require('../analytics/domain-event.service').queue('BOOKING_CREATED', { userId, actorType: 'user', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString(), serviceIds: items.map((item) => item.service._id.toString()), amountMinor: booking.depositMinor, currency: booking.currency, requestType: booking.requestType } }, `booking:${booking._id}:created`);
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

async function getRebookingOptions(userId, bookingId) {
  const booking = await getCustomerBooking(userId, bookingId);
  const { snapshots } = bookingTiming(booking);
  const services = await Service.find({ _id: { $in: snapshots.map((snapshot) => snapshot.serviceId) }, status: 'active', moderationStatus: 'approved' });
  const servicesById = new Map(services.map((service) => [service._id.toString(), service]));
  const orderedServices = snapshots.map((snapshot) => servicesById.get(snapshot.serviceId.toString()));
  if (orderedServices.some((service) => !service)) throw new AppError(409, 'SERVICE_NO_LONGER_AVAILABLE', 'One or more services are no longer available for rebooking');
  const commonLocationTypes = orderedServices.slice(1).reduce((common, service) => common.filter((type) => service.locationTypes.includes(type)), [...orderedServices[0].locationTypes]);
  const locationType = commonLocationTypes.includes(booking.locationType) ? booking.locationType : commonLocationTypes[0];
  if (!locationType) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', 'The selected services no longer share a booking location');
  const service = orderedServices[0];
  return {
    service: service.toPublicJSON(),
    services: orderedServices.map((item) => item.toPublicJSON()),
    defaults: {
      serviceId: service._id.toString(),
      variantId: booking.serviceSnapshot.variantId?.toString() || undefined,
      services: snapshots.map((snapshot) => ({ serviceId: snapshot.serviceId.toString(), variantId: snapshot.variantId?.toString() || undefined })),
      locationType,
      locationId: locationType === 'at_business' ? booking.locationId?.toString() || undefined : undefined
    }
  };
}

async function getRecurringBookingOptions(userId, bookingId) {
  const booking = await getCustomerBooking(userId, bookingId);
  const { snapshots } = bookingTiming(booking);
  const durationMs = new Date(booking.endAt).getTime() - new Date(booking.startAt).getTime();
  const start = new Date(booking.startAt);
  const frequencies = [{ key: 'weekly', label: 'Every week', intervalDays: 7 }, { key: 'biweekly', label: 'Every two weeks', intervalDays: 14 }, { key: 'monthly', label: 'Every four weeks', intervalDays: 28 }];
  return { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString(), services: snapshots.map((snapshot) => ({ serviceId: snapshot.serviceId.toString(), variantId: snapshot.variantId?.toString() || undefined })), totalDurationMinutes: booking.totalDurationMinutes || Math.round(durationMs / 60_000), timezone: booking.timezone, frequencies: frequencies.map((frequency) => ({ ...frequency, preview: Array.from({ length: 4 }, (_, index) => { const date = new Date(start.getTime() + frequency.intervalDays * (index + 1) * 86_400_000); return { startAt: date, endAt: new Date(date.getTime() + durationMs) }; }) })), maxOccurrences: 12, requiresNewBookingPayment: true, note: 'Each occurrence must pass the existing availability, lock, and payment checks before it is created.' };
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
  if (['rejected', 'cancelled_by_business', 'no_show'].includes(target)) await waitlistService.offerForReleasedBooking(booking);
  const eventName = target === 'confirmed' ? 'BOOKING_CONFIRMED' : target === 'completed' ? 'BOOKING_COMPLETED' : ['cancelled_by_business', 'no_show', 'rejected'].includes(target) ? 'BOOKING_CANCELLED' : null;
  if (eventName) await require('../analytics/domain-event.service').queue(eventName, { actorId, actorType: 'user', businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString(), amountMinor: booking.depositMinor, currency: booking.currency, status: target, reason: reason || null } }, `booking:${booking._id}:${eventName.toLowerCase()}`);
  if (target === 'completed') await notificationService.createNotification({ userId: booking.customerId, type: 'booking_follow_up', title: 'How was your appointment?', body: `Your ${booking.serviceSnapshot.serviceName} appointment is complete. Share feedback or book it again when you are ready.`, data: { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString() }, deduplicationKey: bookingFollowUpDeduplicationKey(booking._id) });
  return booking;
}

async function cancelCustomerBooking(userId, bookingId, reason) {
  const booking = await getCustomerBooking(userId, bookingId);
  if (!['pending_payment', 'requested', 'confirmed', 'upcoming'].includes(booking.status)) throw new AppError(409, 'BOOKING_CANCELLATION_NOT_AVAILABLE', 'This booking cannot be cancelled in its current state');
  const { snapshots } = bookingTiming(booking);
  const cancellationWindowHours = Math.max(...snapshots.map((snapshot) => snapshot.cancellationWindowHours || 0));
  if (booking.startAt.getTime() - Date.now() < cancellationWindowHours * 60 * 60_000) throw new AppError(409, 'BOOKING_CANCELLATION_WINDOW_PASSED', 'This booking is inside the cancellation window');
  booking.status = 'cancelled_by_customer'; booking.cancellation = { reason: reason || 'Customer cancelled booking', cancelledBy: userId, cancelledAt: new Date() }; booking.timeline.push({ status: booking.status, actorId: userId, note: booking.cancellation.reason });
  await releaseBookingLocks(booking._id); await promotionService.releasePromotionForBooking(booking._id); await booking.save(); await waitlistService.offerForReleasedBooking(booking); await require('../analytics/domain-event.service').queue('BOOKING_CANCELLED', { userId, actorType: 'user', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), amountMinor: booking.depositMinor, currency: booking.currency, reason: booking.cancellation.reason } }, `booking:${booking._id}:cancelled`); return booking;
}

function bookingFollowUpDeduplicationKey(bookingId) {
  return `booking-follow-up:${bookingId.toString()}`;
}

async function rescheduleBooking({ booking, actorId, newStartAt, reason }) {
  if (!['requested', 'confirmed', 'upcoming'].includes(booking.status)) throw new AppError(409, 'BOOKING_RESCHEDULE_NOT_AVAILABLE', 'This booking cannot be rescheduled in its current state');
  const oldStartAt = booking.startAt; const oldEndAt = booking.endAt;
  await releaseBookingLocks(booking._id);
  try {
    const { snapshots, timing } = bookingTiming(booking);
    const services = await Service.find({ _id: { $in: snapshots.map((snapshot) => snapshot.serviceId) }, status: 'active', moderationStatus: 'approved' });
    const rule = await availabilityService.getAvailabilityRule(booking.businessId, booking.staffUserId, booking.locationId);
    const minNoticeMinutes = services.length ? Math.max(...services.map((service) => service.minNoticeMinutes || 0)) : 0;
    const maxAdvanceDays = services.length ? Math.min(...services.map((service) => service.maxAdvanceDays || 730)) : 730;
    await availabilityService.assertSlotAvailable({ businessId: booking.businessId, locationId: booking.locationId, staffUserId: booking.staffUserId, startAt: new Date(newStartAt), durationMinutes: timing.durationMinutes, bufferBeforeMinutes: timing.bufferBeforeMinutes, bufferAfterMinutes: timing.bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes, maxAdvanceDays, excludeBookingId: booking._id });
    const newEndAt = new Date(new Date(newStartAt).getTime() + timing.durationMinutes * 60_000);
    await claimBookingLocks({ bookingId: booking._id, businessId: booking.businessId, locationId: booking.locationId, staffUserId: booking.staffUserId, startAt: new Date(new Date(newStartAt).getTime() - timing.bufferBeforeMinutes * 60_000), endAt: new Date(newEndAt.getTime() + timing.bufferAfterMinutes * 60_000), expiresAt: booking.holdExpiresAt || newEndAt });
    booking.startAt = new Date(newStartAt); booking.endAt = newEndAt; booking.timezone = rule.timezone; booking.rescheduleHistory.push({ oldStartAt, oldEndAt, newStartAt: booking.startAt, newEndAt, requestedBy: actorId, reason: reason || '' }); booking.timeline.push({ status: 'rescheduled', actorId, note: reason || 'Booking time changed.' });
    await booking.save(); return booking;
  } catch (error) {
    await releaseBookingLocks(booking._id);
    try { const { timing } = bookingTiming(booking); await claimBookingLocks({ bookingId: booking._id, businessId: booking.businessId, locationId: booking.locationId, staffUserId: booking.staffUserId, startAt: new Date(oldStartAt.getTime() - timing.bufferBeforeMinutes * 60_000), endAt: new Date(oldEndAt.getTime() + timing.bufferAfterMinutes * 60_000), expiresAt: booking.holdExpiresAt || oldEndAt }); } catch (_restoreError) { /* original booking remains persisted; reconciliation can repair locks */ }
    throw error;
  }
}

function reminderWindows(now = new Date()) {
  const current = new Date(now).getTime();
  return [
    { key: '24h', from: new Date(current + 23 * 60 * 60_000), to: new Date(current + 25 * 60 * 60_000) },
    { key: '1h', from: new Date(current + 55 * 60_000), to: new Date(current + 65 * 60_000) }
  ];
}

async function processBookingReminders(now = new Date()) {
  const windows = reminderWindows(now);
  let sent = 0;
  for (const window of windows) {
    const bookings = await Booking.find({ status: { $in: ['confirmed', 'upcoming'] }, startAt: { $gte: window.from, $lt: window.to } }).select('_id bookingNumber customerId businessId serviceSnapshot startAt timezone').limit(500);
    for (const booking of bookings) {
      const data = { bookingId: booking._id.toString(), bookingNumber: booking.bookingNumber, startAt: booking.startAt, timezone: booking.timezone };
      const customerNotification = await notificationService.createNotification({
        userId: booking.customerId,
        type: 'booking_reminder',
        title: window.key === '1h' ? 'Your appointment is coming up' : 'Appointment reminder',
        body: `${booking.serviceSnapshot.serviceName} starts ${window.key === '1h' ? 'in about an hour' : 'tomorrow'}.`,
        data,
        deduplicationKey: `booking-reminder:${booking._id}:${window.key}:customer`
      });
      if (customerNotification) sent += 1;
      const owner = await BusinessMembership.findOne({ businessId: booking.businessId, role: 'owner', status: 'active' }).select('userId');
      if (owner) {
        const ownerNotification = await notificationService.createNotification({
          userId: owner.userId,
          type: 'booking_reminder',
          title: window.key === '1h' ? 'Appointment starting soon' : 'Upcoming appointment',
          body: `${booking.serviceSnapshot.serviceName} has an appointment ${window.key === '1h' ? 'in about an hour' : 'tomorrow'}.`,
          data,
          deduplicationKey: `booking-reminder:${booking._id}:${window.key}:owner`
        });
        if (ownerNotification) sent += 1;
      }
    }
  }
  return { windows: windows.length, sent };
}

module.exports = { bookingNumber, lockBuckets, claimBookingLocks, releaseBookingLocks, expireBookingHolds, createBooking, listCustomerBookings, getCustomerBooking, getRebookingOptions, getRecurringBookingOptions, listBusinessBookings, getBusinessBooking, transitionBusinessBooking, cancelCustomerBooking, rescheduleBooking, resolveBookingContext, resolveBundleBookingContext, normalizeServiceSelections, bundleTiming, bookingTiming, reminderWindows, processBookingReminders, bookingFollowUpDeduplicationKey };
