const crypto = require('node:crypto');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { Order } = require('../src/modules/orders/order.model');
const { Business } = require('../src/modules/businesses/business.model');
const { Booking } = require('../src/modules/bookings/booking.model');
const { Refund } = require('../src/modules/payments/refund.model');
const { SubscriptionInvoice } = require('../src/modules/subscriptions/subscription-invoice.model');
const { PromotionEvent } = require('../src/modules/advertising/promotion-event.model');
const { AnalyticsEvent } = require('../src/modules/analytics/analytics-event.model');
const { enqueueDomainEvent } = require('../src/modules/analytics/analytics-outbox.service');

function parseArgs(argv = process.argv.slice(2)) { const args = { apply: false, limit: 500, businessId: null }; for (let i = 0; i < argv.length; i += 1) { if (argv[i] === '--apply') args.apply = true; else if (argv[i] === '--limit') args.limit = Math.max(1, Number.parseInt(argv[++i], 10) || 500); else if (argv[i] === '--business') args.businessId = argv[++i] || null; } return args; }
function eventNameForOrder(order) { if (order.status === 'completed') return 'ORDER_COMPLETED'; if (order.status === 'delivered') return 'ORDER_DELIVERED'; if (order.status === 'cancelled') return 'ORDER_CANCELLED'; if (['successful', 'refunded', 'partially_refunded'].includes(order.paymentStatus)) return 'ORDER_PAID'; return null; }
function eventNameForBooking(booking) { if (booking.status === 'completed') return 'BOOKING_COMPLETED'; if (['cancelled_by_customer', 'cancelled_by_business', 'no_show', 'rejected'].includes(booking.status)) return 'BOOKING_CANCELLED'; if (['successful', 'refunded', 'partially_refunded'].includes(booking.paymentStatus)) return 'BOOKING_CONFIRMED'; return null; }
async function queueOrCount(args, eventName, payload, key, report) { if (!eventName) return; report.considered += 1; if (args.apply) await enqueueDomainEvent(eventName, payload, key); report.queued += args.apply ? 1 : 0; }
async function runBackfill(args = parseArgs(), logger = console) {
  const report = { dryRun: !args.apply, considered: 0, queued: 0, legacyEventsMigrated: 0 };
  const businessFilter = args.businessId ? { businessIds: args.businessId } : {};
  const [businesses, orders, bookings, refunds, invoices, promotions] = await Promise.all([
    Business.find(args.businessId ? { _id: args.businessId } : {}).sort({ createdAt: 1 }).limit(args.limit), Order.find(businessFilter).sort({ createdAt: 1 }).limit(args.limit), Booking.find(args.businessId ? { businessId: args.businessId } : {}).sort({ createdAt: 1 }).limit(args.limit),
    Refund.find({ ...(args.businessId ? { businessId: args.businessId } : {}), status: 'completed' }).sort({ createdAt: 1 }).limit(args.limit), SubscriptionInvoice.find({ ...(args.businessId ? { businessId: args.businessId } : {}), status: 'paid' }).sort({ createdAt: 1 }).limit(args.limit),
    PromotionEvent.find({ status: 'accepted' }).sort({ createdAt: 1 }).limit(args.limit)
  ]);
  for (const business of businesses) await queueOrCount(args, 'BUSINESS_CREATED', { userId: business.ownerId, actorType: 'system', businessId: business._id, entityType: 'business', entityId: business._id, metadata: { businessId: business._id.toString() } }, `backfill:business:${business._id}:created`, report);
  for (const order of orders) await queueOrCount(args, eventNameForOrder(order), { userId: order.customerId, actorType: 'system', businessId: order.businessIds[0], locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), amountMinor: order.totalMinor, currency: order.currency } }, `backfill:order:${order._id}:${eventNameForOrder(order)}`, report);
  for (const booking of bookings) await queueOrCount(args, eventNameForBooking(booking), { userId: booking.customerId, actorType: 'system', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), amountMinor: booking.depositMinor, currency: booking.currency } }, `backfill:booking:${booking._id}:${eventNameForBooking(booking)}`, report);
  for (const refund of refunds) await queueOrCount(args, refund.orderId ? 'ORDER_REFUNDED' : refund.bookingId ? 'BOOKING_REFUNDED' : null, { actorType: 'system', businessId: refund.businessId, entityType: refund.orderId ? 'order' : 'booking', entityId: refund.orderId || refund.bookingId, metadata: { amountMinor: refund.amountMinor, currency: refund.currency, reason: refund.reason } }, `backfill:refund:${refund._id}`, report);
  for (const invoice of invoices) await queueOrCount(args, 'SUBSCRIPTION_RENEWED', { actorType: 'system', businessId: invoice.businessId, entityType: 'business', entityId: invoice.businessId, metadata: { invoiceId: invoice._id.toString(), amountMinor: invoice.totalMinor, currency: invoice.currency } }, `backfill:subscription:${invoice._id}`, report);
  for (const event of promotions) { const name = event.type === 'impression' ? 'PROMOTION_IMPRESSION' : event.type === 'click' ? 'PROMOTION_CLICK' : 'PROMOTION_CONVERSION'; await queueOrCount(args, name, { actorType: event.userId ? 'user' : 'anonymous', userId: event.userId, source: 'SPONSORED', placement: event.placement, metadata: { campaignId: event.campaignId, amountMinor: event.spendMinor || 0 } }, `backfill:promotion:${event._id}`, report); }
  if (args.apply) {
    const legacy = await AnalyticsEvent.find({ $or: [{ eventId: { $exists: false } }, { eventId: null }, { eventId: '' }, { authority: { $exists: false } }] }).limit(args.limit);
    for (const event of legacy) { await AnalyticsEvent.updateOne({ _id: event._id }, { $set: { eventId: event.eventId || `legacy_${event._id}_${crypto.randomBytes(3).toString('hex')}`, eventVersion: event.eventVersion || 1, authority: event.authority || 'client', actorType: event.actorType || (event.userId ? 'user' : 'anonymous'), actorId: event.actorId || event.userId || null, source: event.source || 'APP', platform: event.platform || 'server', metadata: event.metadata || event.properties || {}, receivedAt: event.receivedAt || event.createdAt || new Date(), retentionClass: event.retentionClass || 'behavioral' } }); report.legacyEventsMigrated += 1; }
  }
  logger.info(`${args.apply ? 'Applied' : 'Would apply'} analytics backfill`); return report;
}
async function main() { const args = parseArgs(); await connectDatabase(); try { console.log(JSON.stringify(await runBackfill(args), null, 2)); } finally { await disconnectDatabase(); } }
if (require.main === module) main().catch((error) => { console.error(`Analytics backfill failed: ${error.message}`); process.exitCode = 1; });
module.exports = { parseArgs, runBackfill, eventNameForOrder, eventNameForBooking };
