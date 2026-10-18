const { AppError } = require('../../common/errors/AppError');
const { Service } = require('../services/service.model');
const { BookingWaitlist } = require('./booking-waitlist.model');
const { Booking } = require('./booking.model');
const notificationService = require('../notifications/notification.service');
const { assertUserCanActById } = require('../users/user-status.service');

async function joinWaitlist(customerId, input) {
  await assertUserCanActById(customerId);
  const service = await Service.findOne({ _id: input.serviceId, status: 'active', moderationStatus: 'approved' }).select('businessId locationTypes locationIds staffUserIds');
  if (!service) throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found');
  if (!service.locationTypes.includes(input.locationType)) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', 'This service does not support the selected location type');
  if (input.staffUserId && !service.staffUserIds.some((id) => id.toString() === input.staffUserId)) throw new AppError(409, 'SERVICE_STAFF_UNAVAILABLE', 'The selected professional is not assigned to this service');
  if (input.locationId && service.locationIds.length && !service.locationIds.some((id) => id.toString() === input.locationId)) throw new AppError(409, 'SERVICE_LOCATION_UNAVAILABLE', 'This service is not offered at the selected branch');
  const existing = await BookingWaitlist.findOne({ customerId, serviceId: service._id, status: { $in: ['waiting', 'offered'] } });
  if (existing) return existing;
  return BookingWaitlist.create({ customerId, businessId: service.businessId, serviceId: service._id, staffUserId: input.staffUserId || null, locationType: input.locationType, locationId: input.locationId || null, preferredStartAt: input.preferredStartAt || null });
}

async function listWaitlist(customerId) {
  const items = await BookingWaitlist.find({ customerId, status: { $in: ['waiting', 'offered'] } })
    .populate('serviceId', 'name slug')
    .populate('businessId', 'name slug')
    .sort({ createdAt: -1 })
    .limit(100);
  return items.map((item) => item.toSafeJSON());
}

async function leaveWaitlist(customerId, waitlistId) {
  const item = await BookingWaitlist.findOne({ _id: waitlistId, customerId, status: { $in: ['waiting', 'offered'] } });
  if (!item) throw new AppError(404, 'WAITLIST_ENTRY_NOT_FOUND', 'Waitlist entry not found');
  item.status = 'cancelled';
  await item.save();
  return item;
}

async function offerForReleasedBooking(booking) {
  const start = new Date(booking.startAt);
  const candidates = await BookingWaitlist.find({ serviceId: booking.serviceId, status: 'waiting', $or: [{ locationId: null }, { locationId: booking.locationId || null }], $and: [{ $or: [{ preferredStartAt: null }, { preferredStartAt: { $gte: new Date(start.getTime() - 30 * 60_000), $lte: new Date(start.getTime() + 30 * 60_000) } }] }] }).sort({ createdAt: 1 }).limit(5);
  let offered = 0;
  for (const item of candidates) {
    const claimed = await BookingWaitlist.findOneAndUpdate({ _id: item._id, status: 'waiting' }, { $set: { status: 'offered', offeredAt: new Date(), offeredStartAt: booking.startAt, offerExpiresAt: new Date(Date.now() + 24 * 60 * 60_000), updatedAt: new Date() } }, { new: true });
    if (!claimed) continue;
    await notificationService.createNotification({ userId: claimed.customerId, type: 'booking_waitlist_offer', title: 'A booking slot is available', body: `A slot for ${booking.serviceSnapshot.serviceName} is now available.`, data: { waitlistId: claimed._id.toString(), serviceId: claimed.serviceId.toString(), startAt: booking.startAt }, deduplicationKey: `waitlist-offer:${claimed._id}:${booking._id}` });
    offered += 1;
  }
  return offered;
}

async function acceptWaitlistOffer(customerId, waitlistId) {
  const item = await BookingWaitlist.findOneAndUpdate(
    { _id: waitlistId, customerId, status: 'offered', offerExpiresAt: { $gt: new Date() }, offeredStartAt: { $ne: null } },
    { $set: { status: 'accepting', updatedAt: new Date() } },
    { new: true }
  );
  if (!item) throw new AppError(409, 'WAITLIST_OFFER_UNAVAILABLE', 'This waitlist offer is no longer available');
  try {
    const bookingService = require('./booking.service');
    const booking = await bookingService.createBooking(customerId, {
      clientRequestId: `waitlist:${item._id.toString()}`,
      serviceId: item.serviceId,
      staffUserId: item.staffUserId || undefined,
      locationType: item.locationType,
      locationId: item.locationId || undefined,
      startAt: item.offeredStartAt,
      requestType: 'instant'
    });
    item.status = 'converted';
    item.convertedBookingId = booking._id;
    item.updatedAt = new Date();
    await item.save();
    return { waitlist: item, booking };
  } catch (error) {
    await BookingWaitlist.updateOne({ _id: item._id, status: 'accepting' }, { $set: { status: 'offered', updatedAt: new Date() } });
    throw error;
  }
}

function staleAcceptingStatus(item, booking, now = new Date()) {
  if (booking) return 'converted';
  return item.offerExpiresAt && item.offerExpiresAt <= now ? 'expired' : 'offered';
}

async function expireWaitlistOffers(now = new Date()) {
  const expired = await BookingWaitlist.updateMany({ status: 'offered', offerExpiresAt: { $lte: now } }, { $set: { status: 'expired', updatedAt: now } });
  const staleAccepting = await BookingWaitlist.find({ status: 'accepting', updatedAt: { $lte: new Date(now.getTime() - 15 * 60_000) } }).limit(100);
  let recovered = 0;
  for (const item of staleAccepting) {
    const booking = await Booking.findOne({ clientRequestId: `waitlist:${item._id.toString()}`, customerId: item.customerId }).select('_id');
    if (booking) {
      const updated = await BookingWaitlist.updateOne({ _id: item._id, status: 'accepting' }, { $set: { status: staleAcceptingStatus(item, booking, now), convertedBookingId: booking._id, updatedAt: now } });
      recovered += updated.modifiedCount || updated.nModified || 0;
    } else {
      const nextStatus = staleAcceptingStatus(item, null, now);
      const updated = await BookingWaitlist.updateOne({ _id: item._id, status: 'accepting' }, { $set: { status: nextStatus, updatedAt: now } });
      recovered += updated.modifiedCount || updated.nModified || 0;
    }
  }
  return (expired.modifiedCount || expired.nModified || 0) + recovered;
}

module.exports = { joinWaitlist, listWaitlist, leaveWaitlist, offerForReleasedBooking, acceptWaitlistOffer, expireWaitlistOffers, staleAcceptingStatus };
