const { AnalyticsEvent } = require('./analytics-event.model');
const { AnalyticsDailyAggregate } = require('./analytics-daily-aggregate.model');
const { AnalyticsProjectionEvent } = require('./analytics-projection-event.model');
const { AnalyticsMetricDedupe } = require('./analytics-metric-dedupe.model');

const COUNT_FIELDS = {
  BUSINESS_VIEWED: 'views', PRODUCT_VIEWED: 'views', SERVICE_VIEWED: 'views', DISCOVER_VIEWED: 'views', CATEGORY_VIEWED: 'views',
  SEARCH_PERFORMED: 'searches', SEARCH_RESULT_CLICKED: 'searchClicks', PRODUCT_SAVED: 'saves', SERVICE_SAVED: 'saves',
  PRODUCT_UNSAVED: 'unsaves', SERVICE_UNSAVED: 'unsaves', PRODUCT_ADDED_TO_CART: 'addsToCart', PRODUCT_REMOVED_FROM_CART: 'removesFromCart',
  CHECKOUT_STARTED: 'checkouts', BOOKING_STARTED: 'bookingStarts', ORDER_CREATED: 'orders', BOOKING_CREATED: 'bookings',
  ORDER_COMPLETED: 'completedOrders', BOOKING_COMPLETED: 'completedBookings', REVIEW_CREATED: 'reviews',
  PROMOTION_IMPRESSION: 'promotionImpressions', PROMOTION_CLICK: 'promotionClicks', PROMOTION_CONVERSION: 'promotionConversions'
};

function dateKey(date) { return new Date(date || Date.now()).toISOString().slice(0, 10); }
function actorKey(event) { return event.actorId?.toString() || event.anonymousSessionId || event.sessionId || 'anonymous'; }
async function ensureEventId(event) {
  if (event.eventId) return event.eventId;
  // Older analytics documents predate the eventId field. Give them a stable
  // identifier before projection so one malformed legacy record cannot keep
  // the background worker failing forever.
  const eventId = `legacy_${event._id.toString()}`;
  await AnalyticsEvent.updateOne({ _id: event._id, $or: [{ eventId: { $exists: false } }, { eventId: null }, { eventId: '' }] }, { $set: { eventId } });
  event.eventId = eventId;
  return eventId;
}
function aggregateFilter(event, scope, entityType = null, entityId = null) {
  return { dateKey: dateKey(event.occurredAt), scope, businessId: event.businessId || null, locationId: event.locationId || null, entityType, entityId, currency: event.metadata?.currency || null };
}
async function increment(filter, increments) {
  const safe = Object.fromEntries(Object.entries(increments).filter(([, value]) => Number.isFinite(value) && value !== 0));
  if (Object.keys(safe).length === 0) return;
  await AnalyticsDailyAggregate.findOneAndUpdate(filter, { $inc: safe }, { upsert: true, setDefaultsOnInsert: true });
}

async function projectEvent(event) {
  if (!event.eventName) return;
  if (!event.businessId && !['DISCOVER_VIEWED', 'SEARCH_PERFORMED', 'SEARCH_RESULT_CLICKED'].includes(event.eventName)) return;
  const countField = COUNT_FIELDS[event.eventName];
  const entityType = event.entityType || null;
  const entityId = event.entityId || null;
  const base = aggregateFilter(event, event.businessId ? 'business' : 'platform', entityType, entityId);
  if (countField) await increment(base, { [countField]: 1 });
  if (event.eventName.endsWith('_VIEWED') && (event.businessId || entityId)) {
    const uniqueKey = `${base.dateKey}:${event.businessId || 'platform'}:${entityType || 'surface'}:${entityId || 'surface'}:${actorKey(event)}`;
    try {
      await AnalyticsMetricDedupe.create({ key: uniqueKey, expiresAt: new Date(Date.now() + 60 * 60 * 24 * 400 * 1_000) });
      await increment(base, { uniqueViews: 1 });
    } catch (error) { if (error?.code !== 11000) throw error; }
  }
  const amount = Number(event.metadata?.amountMinor || 0);
  const currency = event.metadata?.currency || null;
  if (amount > 0 && currency) {
    const financial = aggregateFilter({ ...event, metadata: { ...event.metadata, currency } }, event.businessId ? 'business' : 'platform', null, null);
    const salesField = ['ORDER_PAID', 'BOOKING_CONFIRMED'].includes(event.eventName) ? 'grossSalesMinor' : null;
    const refundField = ['ORDER_REFUNDED', 'BOOKING_REFUNDED'].includes(event.eventName) ? 'refundsMinor' : null;
    if (salesField) await increment(financial, { [salesField]: amount, netSalesMinor: amount });
    if (refundField) await increment(financial, { [refundField]: amount });
  }
}

async function projectOne(event) {
  try {
    await AnalyticsProjectionEvent.create({ eventId: event.eventId });
  } catch (error) {
    if (error?.code === 11000) return false;
    throw error;
  }
  await projectEvent(event);
  return true;
}

async function processPending(limit = 100, eventFilter = {}) {
  const events = await AnalyticsEvent.find({ aggregatedAt: null, ...eventFilter }).sort({ receivedAt: 1 }).limit(limit);
  let processed = 0;
  for (const event of events) {
    try {
      await ensureEventId(event);
      if (await projectOne(event)) processed += 1;
      await AnalyticsEvent.updateOne({ _id: event._id, aggregatedAt: null }, { $set: { aggregatedAt: new Date() } });
    } catch (error) { console.error('Analytics projection failed:', error.message); }
  }
  return processed;
}

module.exports = { processPending, projectEvent, projectOne, ensureEventId, dateKey, COUNT_FIELDS };
