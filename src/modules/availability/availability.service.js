const { AppError } = require('../../common/errors/AppError');
const { AvailabilityRule } = require('./availability.model');
const { BlockedPeriod } = require('./blocked-period.model');
const { Booking } = require('../bookings/booking.model');
const { BookingSlotLock } = require('../bookings/booking-slot-lock.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { BusinessMembership } = require('../businesses/business-membership.model');

const ACTIVE_STATUSES = ['pending_payment', 'requested', 'confirmed', 'upcoming', 'checked_in', 'in_progress', 'reschedule_requested'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}

function dateString(year, month, day) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }

function zonedDateTimeToUtc(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const local = getZonedParts(new Date(naive), timeZone);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return new Date(naive - (localAsUtc - naive));
}

function eachDate(from, to) {
  const output = [];
  const cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);
  while (cursor <= end) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function minutes(time) { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; }
function timeFromMinutes(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function dateDayOfWeek(date) { return new Date(`${date}T12:00:00.000Z`).getUTCDay(); }
function assertTimezone(timeZone) { try { new Intl.DateTimeFormat('en-US', { timeZone }).format(); } catch (_error) { throw new AppError(400, 'INVALID_TIMEZONE', 'The business timezone is invalid'); } }

async function getRule(businessId, staffUserId = null, locationId = null) {
  const rule = await AvailabilityRule.findOne({ businessId, staffUserId: staffUserId || null, locationId: locationId || null });
  if (rule) return rule;
  const location = await BusinessLocation.findOne({ ...(locationId ? { _id: locationId } : { businessId, active: true }) }).sort({ createdAt: 1 }).select('timezone');
  return { businessId, locationId: locationId || null, staffUserId: staffUserId || null, timezone: location?.timezone || 'Africa/Lagos', slotIntervalMinutes: 30, weeklyRules: [], overrides: [] };
}

function intervalsForDate(rule, date) {
  const override = rule.overrides?.find((item) => item.date === date);
  if (override) return override.closed ? [] : override.intervals;
  const weekly = rule.weeklyRules?.find((item) => item.dayOfWeek === dateDayOfWeek(date));
  return weekly?.enabled === false ? [] : (weekly?.intervals || []);
}

async function saveAvailability(businessId, input) {
  assertTimezone(input.timezone);
  if (input.locationId && !await BusinessLocation.exists({ _id: input.locationId, businessId, active: true })) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'The selected business location is unavailable');
  if (input.staffUserId) {
    const membership = await BusinessMembership.findOne({ businessId, userId: input.staffUserId, status: 'active' }).select('locationAccess');
    if (!membership) throw new AppError(400, 'INVALID_AVAILABILITY_STAFF', 'The selected staff member is not active in this business');
    if (membership.locationAccess?.mode === 'selected' && input.locationId && !membership.locationAccess.locationIds.some((id) => id.toString() === input.locationId.toString())) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'The staff member is not assigned to this location');
  }
  return AvailabilityRule.findOneAndUpdate({ businessId, locationId: input.locationId || null, staffUserId: input.staffUserId || null }, { ...input, businessId, locationId: input.locationId || null, staffUserId: input.staffUserId || null }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
}

async function getAvailabilityRule(businessId, staffUserId = null, locationId = null) { return getRule(businessId, staffUserId, locationId); }

async function listBlockedPeriods(businessId, staffUserId, from, to, locationId = null) {
  const filter = { businessId, active: true, startAt: { $lt: to }, endAt: { $gt: from } };
  filter.$and = [{ $or: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] }];
  filter.$or = [{ staffUserId: null }, ...(staffUserId ? [{ staffUserId }] : [])];
  return BlockedPeriod.find(filter).sort({ startAt: 1 });
}

async function hasConflict({ businessId, locationId = null, staffUserId, startAt, endAt, excludeBookingId = null, bookings = null, blockedPeriods = null }) {
  if (bookings && blockedPeriods) {
    const bookingConflict = bookings.some((booking) => (!excludeBookingId || booking._id.toString() !== excludeBookingId.toString()) && new Date(booking.startAt) < endAt && new Date(booking.endAt) > startAt);
    const blockedConflict = blockedPeriods.some((block) => new Date(block.startAt) < endAt && new Date(block.endAt) > startAt);
    return bookingConflict || blockedConflict;
  }
  const filter = { businessId, ...(locationId ? { locationId } : { locationId: null }), status: { $in: ACTIVE_STATUSES }, startAt: { $lt: endAt }, endAt: { $gt: startAt }, ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}) };
  filter.staffUserId = staffUserId || null;
  const conflict = await Booking.exists(filter);
  if (conflict) return true;
  const blockedFilter = { businessId, active: true, startAt: { $lt: endAt }, endAt: { $gt: startAt }, $and: [{ $or: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] }], $or: [{ staffUserId: null }, ...(staffUserId ? [{ staffUserId }] : [])] };
  return Boolean(await BlockedPeriod.exists(blockedFilter));
}

async function assertSlotAvailable({ businessId, locationId = null, staffUserId = null, startAt, durationMinutes, bufferBeforeMinutes = 0, bufferAfterMinutes = 0, timezone, minNoticeMinutes = 0, maxAdvanceDays = 730, excludeBookingId = null, bookings = null, blockedPeriods = null }) {
  assertTimezone(timezone);
  const start = new Date(startAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const now = Date.now();
  if (start.getTime() < now + minNoticeMinutes * 60_000) throw new AppError(409, 'BOOKING_MINIMUM_NOTICE', 'This appointment does not meet the minimum notice requirement');
  if (start.getTime() > now + maxAdvanceDays * 86_400_000) throw new AppError(409, 'BOOKING_TOO_FAR_AHEAD', 'This appointment is outside the advance booking window');
  const localStart = getZonedParts(start, timezone);
  const localEnd = getZonedParts(new Date(end.getTime() + bufferAfterMinutes * 60_000), timezone);
  if (localStart.year !== localEnd.year || localStart.month !== localEnd.month || localStart.day !== localEnd.day) throw new AppError(409, 'BOOKING_CROSSES_DAY_BOUNDARY', 'Choose a time that finishes on the same local business day');
  const localDate = dateString(localStart.year, localStart.month, localStart.day);
  const location = locationId ? await BusinessLocation.findOne({ _id: locationId, businessId, active: true }).select('openingHours specialHours timezone') : null;
  if (locationId && !location) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'The selected business location is unavailable');
  const rule = await getRule(businessId, staffUserId, locationId);
  const special = location?.specialHours?.find((item) => item.date === localDate);
  const branchIntervals = special ? (special.closed ? [] : special.intervals) : (location?.openingHours?.find((item) => item.dayOfWeek === new Date(`${localDate}T12:00:00.000Z`).getUTCDay())?.intervals || null);
  if (branchIntervals && (!branchIntervals.length || special?.closed)) throw new AppError(409, 'LOCATION_CLOSED', 'The selected branch is closed at this time');
  const intervals = branchIntervals || intervalsForDate(rule, localDate);
  const effectiveStart = new Date(start.getTime() - bufferBeforeMinutes * 60_000);
  const effectiveEnd = new Date(end.getTime() + bufferAfterMinutes * 60_000);
  const fitsSchedule = intervals.some((interval) => effectiveStart >= zonedDateTimeToUtc(localDate, interval.start, timezone) && effectiveEnd <= zonedDateTimeToUtc(localDate, interval.end, timezone));
  if (!fitsSchedule) throw new AppError(409, 'BOOKING_OUTSIDE_AVAILABILITY', 'The selected time is outside the professional availability');
  if (await hasConflict({ businessId, locationId, staffUserId, startAt: effectiveStart, endAt: effectiveEnd, excludeBookingId, bookings, blockedPeriods })) throw new AppError(409, 'BOOKING_SLOT_UNAVAILABLE', 'This time is no longer available');
  return { startAt: start, endAt: end, effectiveStart, effectiveEnd, timezone, rule };
}

async function getAvailableSlots({ businessId, locationId = null, service, variantId = null, staffUserId = null, from, to }) {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) throw new AppError(400, 'INVALID_AVAILABILITY_RANGE', 'Availability range must use valid dates in ascending order');
  if (eachDate(from, to).length > 31) throw new AppError(400, 'AVAILABILITY_RANGE_TOO_LARGE', 'Request availability for at most 31 days at a time');
  const variant = variantId ? service.variants.find((item) => item.variantId.toString() === variantId.toString() && item.active) : null;
  if (variantId && !variant) throw new AppError(404, 'SERVICE_VARIANT_NOT_FOUND', 'Service variant not found');
  const durationMinutes = variant?.durationMinutes || service.durationMinutes;
  const bufferBeforeMinutes = variant?.bufferBeforeMinutes ?? service.bufferBeforeMinutes;
  const bufferAfterMinutes = variant?.bufferAfterMinutes ?? service.bufferAfterMinutes;
  const rule = await getRule(businessId, staffUserId, locationId);
  assertTimezone(rule.timezone);
  await releaseExpiredBookingHolds();
  const rangeStart = zonedDateTimeToUtc(from, '00:00', rule.timezone);
  const rangeEnd = zonedDateTimeToUtc(to, '23:59', rule.timezone);
  const bookings = await Booking.find({ businessId, locationId: locationId || null, staffUserId: staffUserId || null, status: { $in: ACTIVE_STATUSES }, startAt: { $lt: rangeEnd }, endAt: { $gt: rangeStart } }).select('_id startAt endAt').lean();
  const blockedFilter = { businessId, active: true, startAt: { $lt: rangeEnd }, endAt: { $gt: rangeStart }, $and: [{ $or: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])] }], $or: [{ staffUserId: null }, ...(staffUserId ? [{ staffUserId }] : [])] };
  const blockedPeriods = await BlockedPeriod.find(blockedFilter).select('startAt endAt').lean();
  const slots = [];
  for (const date of eachDate(from, to)) {
    for (const interval of intervalsForDate(rule, date)) {
      const startMinute = minutes(interval.start) + bufferBeforeMinutes;
      const endMinute = minutes(interval.end) - durationMinutes - bufferAfterMinutes;
      for (let candidate = startMinute; candidate <= endMinute; candidate += rule.slotIntervalMinutes) {
        const startAt = zonedDateTimeToUtc(date, timeFromMinutes(candidate), rule.timezone);
        try {
          await assertSlotAvailable({ businessId, locationId, staffUserId, startAt, durationMinutes, bufferBeforeMinutes, bufferAfterMinutes, timezone: rule.timezone, minNoticeMinutes: service.minNoticeMinutes, maxAdvanceDays: service.maxAdvanceDays, bookings, blockedPeriods });
          slots.push({ startAt, endAt: new Date(startAt.getTime() + durationMinutes * 60_000), timezone: rule.timezone, staffUserId: staffUserId || null, locationId: locationId || null });
        } catch (error) {
          if (!(error instanceof AppError) || !['BOOKING_MINIMUM_NOTICE', 'BOOKING_SLOT_UNAVAILABLE', 'BOOKING_OUTSIDE_AVAILABILITY', 'BOOKING_TOO_FAR_AHEAD'].includes(error.code)) throw error;
        }
      }
    }
  }
  return slots;
}

async function releaseExpiredBookingHolds() {
  const expired = await Booking.find({ status: { $in: ['pending_payment', 'requested'] }, holdExpiresAt: { $lte: new Date() } }).select('_id status');
  for (const booking of expired) {
    const status = booking.status === 'requested' ? 'rejected' : 'cancelled_by_business';
    await Booking.updateOne({ _id: booking._id }, { $set: { status }, $push: { timeline: { status, actorId: null, note: 'Booking hold expired before confirmation.' } } });
    await BookingSlotLock.deleteMany({ bookingId: booking._id });
  }
  return expired.length;
}

async function createBlockedPeriod(businessId, input) {
  if (new Date(input.endAt) <= new Date(input.startAt)) throw new AppError(400, 'INVALID_BLOCKED_PERIOD', 'Blocked period end must be after start');
  if (input.locationId && !await BusinessLocation.exists({ _id: input.locationId, businessId, active: true })) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'The selected business location is unavailable');
  if (input.staffUserId && !await BusinessMembership.exists({ businessId, userId: input.staffUserId, status: 'active' })) throw new AppError(400, 'INVALID_AVAILABILITY_STAFF', 'The selected staff member is not active in this business');
  return BlockedPeriod.create({ businessId, locationId: input.locationId || null, staffUserId: input.staffUserId || null, startAt: input.startAt, endAt: input.endAt, reason: input.reason || '' });
}

async function deleteBlockedPeriod(businessId, blockId) {
  const block = await BlockedPeriod.findOneAndUpdate({ _id: blockId, businessId, active: true }, { $set: { active: false } }, { new: true });
  if (!block) throw new AppError(404, 'BLOCKED_PERIOD_NOT_FOUND', 'Blocked period not found');
  return block;
}

module.exports = { getZonedParts, zonedDateTimeToUtc, eachDate, intervalsForDate, getAvailabilityRule, saveAvailability, getAvailableSlots, assertSlotAvailable, createBlockedPeriod, deleteBlockedPeriod, hasConflict, listBlockedPeriods, releaseExpiredBookingHolds };
