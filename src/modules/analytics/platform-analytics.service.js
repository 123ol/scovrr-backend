const { User } = require('../users/user.model');
const { Business } = require('../businesses/business.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { Payment } = require('../payments/payment.model');
const { Refund } = require('../payments/refund.model');
const { LedgerEntry } = require('../payouts/ledger-entry.model');
const { SubscriptionInvoice } = require('../subscriptions/subscription-invoice.model');
const { AnalyticsDailyAggregate } = require('./analytics-daily-aggregate.model');
const { AnalyticsEvent } = require('./analytics-event.model');
const { PaymentRiskAssessment } = require('../payments/payment-risk-assessment.model');
const { PaymentReconciliation } = require('../reconciliation/reconciliation.model');
const { Delivery } = require('../deliveries/delivery.model');
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
async function getRevenueReport(query = {}) {
  const range = parseRange(query);
  const commerce = await getCommerce(range);
  return {
    range,
    currencies: commerce.currencies,
    totals: { orderCount: commerce.orderCount, bookingCount: commerce.bookingCount },
    methodology: 'Payment, refund, platform-commission, subscription-invoice, and promotion records are grouped by currency; currencies are never combined.'
  };
}

async function getSellerGrowthReport(query = {}) {
  const range = parseRange(query);
  const [newBusinesses, activeBusinesses, byDay, byModel] = await Promise.all([
    Business.countDocuments(inRange(range)),
    Business.countDocuments({ status: 'active' }),
    Business.aggregate([
      { $match: inRange(range) },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, businesses: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
      { $limit: 366 }
    ]),
    Business.aggregate([
      { $match: inRange(range) },
      { $group: { _id: '$operatingModel', businesses: { $sum: 1 } } },
      { $sort: { businesses: -1, _id: 1 } }
    ])
  ]);
  return { range, totals: { newBusinesses, activeBusinesses }, byDay: byDay.map((row) => ({ date: row._id, businesses: row.businesses, active: row.active })), byOperatingModel: byModel.map((row) => ({ operatingModel: row._id, businesses: row.businesses })) };
}

async function getLogisticsReport(query = {}) {
  const range = parseRange(query);
  const [statuses, methods, deliveryTiming] = await Promise.all([
    Delivery.aggregate([{ $match: inRange(range) }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }]),
    Delivery.aggregate([{ $match: inRange(range) }, { $group: { _id: { method: '$method', currency: '$currency' }, count: { $sum: 1 }, feeMinor: { $sum: '$feeMinor' } } }, { $sort: { count: -1, '_id.method': 1, '_id.currency': 1 } }]),
    Delivery.aggregate([
      { $match: { deliveredAt: { $gte: range.from, $lt: range.to, $ne: null } } },
      { $group: { _id: null, delivered: { $sum: 1 }, onTime: { $sum: { $cond: [{ $and: [{ $ne: ['$estimatedDeliveryAt', null] }, { $lte: ['$deliveredAt', '$estimatedDeliveryAt'] }] }, 1, 0] } }, averageTransitHours: { $avg: { $divide: [{ $subtract: ['$deliveredAt', '$createdAt'] }, 3_600_000] } } } }
    ])
  ]);
  const delivered = deliveryTiming[0]?.delivered || 0;
  const onTime = deliveryTiming[0]?.onTime || 0;
  return {
    range,
    totals: { deliveries: statuses.reduce((sum, row) => sum + row.count, 0), delivered, failed: statuses.find((row) => row._id === 'failed')?.count || 0, cancelled: statuses.find((row) => row._id === 'cancelled')?.count || 0 },
    byStatus: statuses.map((row) => ({ status: row._id, count: row.count })),
    byMethod: methods.map((row) => ({ method: row._id.method, currency: row._id.currency, count: row.count, feeMinor: row.feeMinor })),
    timing: { delivered, onTime, late: Math.max(delivered - onTime, 0), onTimeRatePercent: delivered ? Number((onTime / delivered * 100).toFixed(2)) : 0, averageTransitHours: Number((deliveryTiming[0]?.averageTransitHours || 0).toFixed(2)) },
    methodology: 'Delivery records are grouped by creation date; on-time status is only calculated when both deliveredAt and estimatedDeliveryAt are present.'
  };
}

async function getEventQualityReport(query = {}) {
  const range = parseRange(query);
  const match = inRange(range, 'occurredAt');
  const [totals, byEvent, clientEvents, clientWithSessions, clientWithDedupe, lateEvents] = await Promise.all([
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: '$authority', count: { $sum: 1 } } }]),
    AnalyticsEvent.aggregate([{ $match: match }, { $group: { _id: { eventName: '$eventName', authority: '$authority' }, count: { $sum: 1 } } }, { $sort: { count: -1, '_id.eventName': 1 } }, { $limit: 100 }]),
    AnalyticsEvent.countDocuments({ ...match, authority: 'client' }),
    AnalyticsEvent.countDocuments({ ...match, authority: 'client', sessionId: { $nin: [null, ''] } }),
    AnalyticsEvent.countDocuments({ ...match, authority: 'client', dedupeKey: { $nin: [null, ''] } }),
    AnalyticsEvent.countDocuments({ ...match, $expr: { $gt: [{ $subtract: ['$receivedAt', '$occurredAt'] }, 5 * 60 * 1_000] } })
  ]);
  const total = totals.reduce((sum, row) => sum + row.count, 0);
  const client = totals.find((row) => row._id === 'client')?.count || 0;
  const percent = (value, denominator) => denominator ? Number((value / denominator * 100).toFixed(2)) : 0;
  return {
    range,
    totals: { events: total, client, server: totals.find((row) => row._id === 'server')?.count || 0, system: totals.find((row) => row._id === 'system')?.count || 0, lateEvents },
    clientQuality: { events: clientEvents, sessionCoveragePercent: percent(clientWithSessions, clientEvents), dedupeCoveragePercent: percent(clientWithDedupe, clientEvents) },
    byEvent: byEvent.map((row) => ({ eventName: row._id.eventName, authority: row._id.authority, count: row.count })),
    methodology: 'Counts are derived from stored analytics events in the selected UTC range. Session and dedupe percentages are coverage indicators, not event validity guarantees.'
  };
}
async function getServicesReport(query = {}) { const range = parseRange(query); const [bookings, completed, cancelled, daily] = await Promise.all([Booking.countDocuments({ ...inRange(range), paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] } }), Booking.countDocuments({ ...inRange(range), status: 'completed' }), Booking.countDocuments({ ...inRange(range), status: { $in: ['cancelled_by_customer', 'cancelled_by_business', 'no_show'] } }), AnalyticsEvent.aggregate([{ $match: { eventName: { $in: ['SERVICE_VIEWED', 'BOOKING_STARTED', 'BOOKING_CONFIRMED', 'BOOKING_COMPLETED'] }, ...inRange(range, 'occurredAt') } }, { $group: { _id: '$eventName', count: { $sum: 1 } } }])]); return { range, metrics: { bookings, completed, cancelled }, funnel: Object.fromEntries(daily.map((row) => [row._id, row.count])) }; }

async function getRetentionReport(query = {}) {
  const range = parseRange(query);
  const paymentFilter = { type: { $in: ['order', 'booking'] }, status: { $in: ['successful', 'refunded', 'partially_refunded'] }, customerId: { $ne: null }, ...inRange(range, 'paidAt') };
  const customers = await Payment.aggregate([{ $match: paymentFilter }, { $group: { _id: '$customerId', transactions: { $sum: 1 } } }]);
  const currentIds = customers.map((row) => row._id).filter(Boolean);
  const priorIds = currentIds.length ? await Payment.distinct('customerId', { type: { $in: ['order', 'booking'] }, status: { $in: ['successful', 'refunded', 'partially_refunded'] }, customerId: { $in: currentIds }, paidAt: { $lt: range.from } }) : [];
  const prior = new Set(priorIds.map((id) => id.toString()));
  const returningCustomers = currentIds.filter((id) => prior.has(id.toString())).length;
  const repeatCustomers = customers.filter((row) => row.transactions > 1).length;
  return { range, customers: { observed: currentIds.length, new: currentIds.length - returningCustomers, returning: returningCustomers, repeatInRange: repeatCustomers }, methodology: 'Successful, refunded, or partially refunded order and booking payments grouped by customer; currencies are not combined into monetary values.' };
}

async function getConversionReport(query = {}) {
  const range = parseRange(query);
  const events = await AnalyticsEvent.aggregate([{ $match: { eventName: { $in: ['PRODUCT_IMPRESSION', 'PRODUCT_VIEWED', 'CHECKOUT_STARTED', 'ORDER_PAID', 'SERVICE_VIEWED', 'BOOKING_STARTED', 'BOOKING_CONFIRMED'], ...inRange(range, 'occurredAt') } } }, { $group: { _id: '$eventName', count: { $sum: 1 } } }]);
  const counts = Object.fromEntries(events.map((row) => [row._id, row.count]));
  const rate = (numerator, denominator) => denominator ? Number((numerator / denominator * 100).toFixed(2)) : 0;
  return { range, counts, rates: { productViewFromImpressionPercent: rate(counts.PRODUCT_VIEWED || 0, counts.PRODUCT_IMPRESSION || 0), checkoutFromProductViewPercent: rate(counts.CHECKOUT_STARTED || 0, counts.PRODUCT_VIEWED || 0), orderPaidFromCheckoutPercent: rate(counts.ORDER_PAID || 0, counts.CHECKOUT_STARTED || 0), bookingConfirmedFromStartPercent: rate(counts.BOOKING_CONFIRMED || 0, counts.BOOKING_STARTED || 0) }, methodology: 'Event counts are behavioral signals; authoritative order and booking state remains in commerce records.' };
}

async function getFinancialRiskReport(query = {}) {
  const range = parseRange(query);
  const [summary, flags] = await Promise.all([
    PaymentRiskAssessment.aggregate([{ $match: inRange(range) }, { $group: { _id: null, assessments: { $sum: 1 }, reviews: { $sum: { $cond: [{ $eq: ['$decision', 'review'] }, 1, 0] } }, averageScore: { $avg: '$score' }, highestScore: { $max: '$score' } } }]),
    PaymentRiskAssessment.aggregate([{ $match: inRange(range) }, { $unwind: '$flags' }, { $group: { _id: '$flags', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 10 }])
  ]);
  return { range, summary: { assessments: summary[0]?.assessments || 0, reviews: summary[0]?.reviews || 0, averageScore: Number((summary[0]?.averageScore || 0).toFixed(2)), highestScore: summary[0]?.highestScore || 0 }, flags: flags.map((row) => ({ flag: row._id, count: row.count })) };
}

async function getReconciliationAlerts(query = {}) {
  const range = parseRange(query);
  const [summary, byMismatch] = await Promise.all([
    PaymentReconciliation.aggregate([{ $match: { status: { $in: ['mismatch', 'action_required'] }, ...inRange(range) } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    PaymentReconciliation.aggregate([{ $match: { status: { $in: ['mismatch', 'action_required'] }, ...inRange(range) } }, { $group: { _id: '$mismatchType', count: { $sum: 1 } } }, { $sort: { count: -1, _id: 1 } }, { $limit: 20 }])
  ]);
  return { range, counts: Object.fromEntries(summary.map((row) => [row._id, row.count])), mismatches: byMismatch.map((row) => ({ type: row._id || 'unknown', count: row.count })) };
}

async function getGeographyReport(query = {}) {
  const range = parseRange(query);
  const rows = await BusinessLocation.aggregate([
    { $match: { active: true } },
    { $lookup: { from: 'businesses', localField: 'businessId', foreignField: '_id', as: 'business' } },
    { $unwind: '$business' },
    { $match: { 'business.status': 'active', 'business.moderationStatus': 'approved' } },
    { $group: { _id: { state: '$address.state', city: '$address.city' }, businessIds: { $addToSet: '$businessId' }, locations: { $sum: 1 }, businessesCreatedInRange: { $sum: { $cond: [{ $and: [{ $gte: ['$business.createdAt', range.from] }, { $lt: ['$business.createdAt', range.to] }] }, 1, 0] } } } },
    { $project: { _id: 0, state: '$_id.state', city: '$_id.city', businesses: { $size: '$businessIds' }, locations: 1, businessesCreatedInRange: 1 } },
    { $sort: { businesses: -1, locations: -1, state: 1, city: 1 } },
    { $limit: 500 }
  ]);
  return { range: { from: range.from, to: range.to, label: range.label }, rows, methodology: 'Active approved business locations grouped by stored Nigerian state and city fields.' };
}

module.exports = { getOverview, getCommerceReport, getRevenueReport, getSellerGrowthReport, getLogisticsReport, getEventQualityReport, getServicesReport, getGeographyReport, getRetentionReport, getConversionReport, getFinancialRiskReport, getReconciliationAlerts, getCommerce };
