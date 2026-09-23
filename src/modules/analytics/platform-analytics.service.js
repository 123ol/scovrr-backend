const { User } = require('../users/user.model');
const { Business } = require('../businesses/business.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { Payment } = require('../payments/payment.model');
const { Refund } = require('../payments/refund.model');
const { LedgerEntry } = require('../payouts/ledger-entry.model');
const { SubscriptionInvoice } = require('../subscriptions/subscription-invoice.model');
const { AnalyticsDailyAggregate } = require('./analytics-daily-aggregate.model');
const { AnalyticsEvent } = require('./analytics-event.model');
const { parseRange, dateMatch, dateKey } = require('./analytics-range');

function inRange(range, field = 'createdAt') { return dateMatch(range, field); }
function money(currency) { return { currency, grossSalesMinor: 0, netSalesMinor: 0, refundsMinor: 0, platformRevenueMinor: 0, subscriptionRevenueMinor: 0, promotionRevenueMinor: 0, orders: 0, bookings: 0 }; }

async function getCommerce(range) {
  const paymentMatch = { type: { $in: ['order', 'booking', 'promotion'] }, status: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range, 'paidAt') };
  const [payments, refunds, commissions, invoices, orders, bookings] = await Promise.all([
    Payment.aggregate([{ $match: paymentMatch }, { $group: { _id: '$currency', gross: { $sum: { $cond: [{ $in: ['$type', ['order', 'booking']] }, '$amountMinor', 0] } }, promotionRevenue: { $sum: { $cond: [{ $eq: ['$type', 'promotion'] }, { $subtract: ['$amountMinor', { $ifNull: ['$refundedAmountMinor', 0] }] }, 0] } }, orders: { $sum: { $cond: [{ $eq: ['$type', 'order'] }, 1, 0] } }, bookings: { $sum: { $cond: [{ $eq: ['$type', 'booking'] }, 1, 0] } } } }]),
    Refund.aggregate([{ $match: { status: 'completed', ...inRange(range) } }, { $group: { _id: '$currency', amount: { $sum: { $cond: [{ $or: [{ $ne: ['$orderId', null] }, { $ne: ['$bookingId', null] }] }, '$amountMinor', 0] } }, promotionAmount: { $sum: { $cond: [{ $ne: ['$campaignId', null] }, '$amountMinor', 0] } } } }]),
    LedgerEntry.aggregate([{ $match: { type: 'platform_commission', direction: 'credit', ...inRange(range) } }, { $group: { _id: '$currency', amount: { $sum: '$amountMinor' } } }]),
    SubscriptionInvoice.aggregate([{ $match: { status: 'paid', ...inRange(range, 'paidAt') } }, { $group: { _id: '$currency', amount: { $sum: '$totalMinor' } } }]),
    Order.countDocuments({ paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range) }),
    Booking.countDocuments({ paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range) })
  ]);
  const currencies = new Set([...payments, ...refunds, ...commissions, ...invoices].map((row) => row._id).filter(Boolean));
  const rows = [...currencies].map((currency) => { const item = money(currency); const payment = payments.find((row) => row._id === currency); const refund = refunds.find((row) => row._id === currency); item.grossSalesMinor = payment?.gross || 0; item.orders = payment?.orders || 0; item.bookings = payment?.bookings || 0; item.refundsMinor = refund?.amount || 0; item.netSalesMinor = Math.max(item.grossSalesMinor - item.refundsMinor, 0); item.platformRevenueMinor = commissions.find((row) => row._id === currency)?.amount || 0; item.subscriptionRevenueMinor = invoices.find((row) => row._id === currency)?.amount || 0; item.promotionRevenueMinor = Math.max((payment?.promotionRevenue || 0) - (refund?.promotionAmount || 0), 0); return item; });
  return { currencies: rows, orderCount: orders, bookingCount: bookings, primary: rows[0] || money(null) };
}

async function getOverview(query = {}) {
  const range = parseRange(query); const commerce = await getCommerce(range);
  const [users, businesses, activeBusinesses, events, daily, activeUsers] = await Promise.all([
    User.countDocuments(inRange(range)), Business.countDocuments(inRange(range)), Business.countDocuments({ status: 'active' }),
    AnalyticsEvent.aggregate([{ $match: inRange(range, 'occurredAt') }, { $group: { _id: '$eventName', count: { $sum: 1 } } }]),
    AnalyticsDailyAggregate.aggregate([{ $match: { scope: 'platform', dateKey: { $gte: dateKey(range.from), $lte: dateKey(new Date(range.to.getTime() - 1)) } } }, { $group: { _id: '$dateKey', views: { $sum: '$views' }, searches: { $sum: '$searches' }, orders: { $sum: '$orders' }, bookings: { $sum: '$bookings' } } }, { $sort: { _id: 1 } }]),
    (async () => {
      const end = range.to;
      const windows = { dau: 24 * 60 * 60_000, wau: 7 * 24 * 60 * 60_000, mau: 30 * 24 * 60 * 60_000 };
      const rows = await Promise.all(Object.entries(windows).map(async ([key, duration]) => [key, await AnalyticsEvent.distinct('actorId', { actorType: 'user', actorId: { $ne: null }, occurredAt: { $gte: new Date(end.getTime() - duration), $lt: end } })]));
      return Object.fromEntries(rows.map(([key, ids]) => [key, ids.length]));
    })()
  ]);
  return { range: { from: range.from, to: range.to, label: range.label }, metrics: { newUsers: users, newBusinesses: businesses, activeBusinesses, ...commerce.primary, ...activeUsers }, eventCounts: Object.fromEntries(events.map((row) => [row._id, row.count])), trend: daily, currencies: commerce.currencies, asOf: new Date() };
}
async function getCommerceReport(query = {}) { const range = parseRange(query); return { range, ...(await getCommerce(range)) }; }
async function getServicesReport(query = {}) { const range = parseRange(query); const [bookings, completed, cancelled, daily] = await Promise.all([Booking.countDocuments({ ...inRange(range), paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] } }), Booking.countDocuments({ ...inRange(range), status: 'completed' }), Booking.countDocuments({ ...inRange(range), status: { $in: ['cancelled_by_customer', 'cancelled_by_business', 'no_show'] } }), AnalyticsEvent.aggregate([{ $match: { eventName: { $in: ['SERVICE_VIEWED', 'BOOKING_STARTED', 'BOOKING_CONFIRMED', 'BOOKING_COMPLETED'] }, ...inRange(range, 'occurredAt') } }, { $group: { _id: '$eventName', count: { $sum: 1 } } }])]); return { range, metrics: { bookings, completed, cancelled }, funnel: Object.fromEntries(daily.map((row) => [row._id, row.count])) }; }

module.exports = { getOverview, getCommerceReport, getServicesReport, getCommerce };
