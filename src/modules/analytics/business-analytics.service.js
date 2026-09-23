const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { Payment } = require('../payments/payment.model');
const { Refund } = require('../payments/refund.model');
const { LedgerEntry } = require('../payouts/ledger-entry.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Promotion } = require('../promotions/promotion.model');
const { PromotionRedemption } = require('../promotions/promotion-redemption.model');
const { PromotionCampaign } = require('../advertising/promotion-campaign.model');
const { PromotionDailyAggregate } = require('../advertising/promotion-daily-aggregate.model');
const { AnalyticsDailyAggregate } = require('./analytics-daily-aggregate.model');
const { parseRange, dateMatch, dateKey } = require('./analytics-range');
const entitlementService = require('../subscriptions/entitlement.service');
const { ENTITLEMENTS } = require('../subscriptions/entitlement-registry');

function oid(value) { return new mongoose.Types.ObjectId(value); }
function inRange(range, field = 'createdAt') { return dateMatch(range, field); }
function selectedLocationIds(membership, locationId) {
  const allowed = membership.locationAccess?.mode === 'selected' ? (membership.locationAccess.locationIds || []).map(oid) : null;
  if (locationId) {
    if (allowed && !allowed.some((item) => item.toString() === String(locationId))) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'You do not have access to this branch');
    return [oid(locationId)];
  }
  return allowed;
}
function locationClause(membership, locationId, field) {
  const ids = selectedLocationIds(membership, locationId);
  return ids ? { [field]: { $in: ids } } : {};
}
function emptyMoney(currency = null) { return { currency, grossSalesMinor: 0, netSalesMinor: 0, refundsMinor: 0, platformRevenueMinor: 0, businessEarningsMinor: 0, subscriptionRevenueMinor: 0, promotionRevenueMinor: 0, orders: 0, bookings: 0, customers: 0, discountsMinor: 0, discountsUsed: 0, aovMinor: 0 }; }

async function aggregateMoney(businessId, range, membership, locationId) {
  const business = oid(businessId);
  const location = locationClause(membership, locationId, 'fulfillmentLocationId');
  const bookingLocation = locationClause(membership, locationId, 'locationId');
  const orderFilter = { businessIds: business, paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range), ...location };
  const bookingFilter = { businessId: business, paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range), ...bookingLocation };
  const paymentFilter = { businessId: business, type: { $in: ['order', 'booking'] }, status: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range, 'paidAt') };
  const refundFilter = { businessId: business, status: 'completed', $or: [{ orderId: { $ne: null } }, { bookingId: { $ne: null } }], ...inRange(range) };
  if (locationId) {
    const [orderIds, bookingIds] = await Promise.all([Order.find(orderFilter).select('_id').lean(), Booking.find(bookingFilter).select('_id').lean()]);
    paymentFilter.$or = [{ orderId: { $in: orderIds.map((item) => item._id) } }, { bookingId: { $in: bookingIds.map((item) => item._id) } }];
    refundFilter.$or = [{ orderId: { $in: orderIds.map((item) => item._id) } }, { bookingId: { $in: bookingIds.map((item) => item._id) } }];
  }
  const [payments, refunds, orders, bookings, commission, sellerCredit, redemptions] = await Promise.all([
    Payment.aggregate([{ $match: paymentFilter }, { $group: { _id: '$currency', gross: { $sum: '$amountMinor' }, count: { $sum: 1 } } }]),
    Refund.aggregate([{ $match: refundFilter }, { $group: { _id: '$currency', amount: { $sum: '$amountMinor' } } }]),
    Order.aggregate([{ $match: orderFilter }, { $group: { _id: '$currency', count: { $sum: 1 }, customers: { $addToSet: '$customerId' } } }]),
    Booking.aggregate([{ $match: bookingFilter }, { $group: { _id: '$currency', count: { $sum: 1 }, customers: { $addToSet: '$customerId' } } }]),
    LedgerEntry.aggregate([{ $match: { businessId: business, type: 'platform_commission', direction: 'credit', ...inRange(range) } }, { $group: { _id: '$currency', amount: { $sum: '$amountMinor' } } }]),
    LedgerEntry.aggregate([{ $match: { businessId: business, type: { $in: ['seller_credit', 'seller_debit'] }, ...inRange(range) } }, { $group: { _id: { currency: '$currency', type: '$type', direction: '$direction' }, amount: { $sum: '$amountMinor' } } }]),
    (async () => { const promotions = await Promotion.find({ businessId: business }).select('_id').lean(); return promotions.length ? PromotionRedemption.aggregate([{ $match: { promotionId: { $in: promotions.map((item) => item._id) }, status: { $in: ['consumed', 'redeemed'] }, ...inRange(range) } }, { $group: { _id: null, used: { $sum: 1 }, amount: { $sum: '$discountMinor' } } }]) : []; })()
  ]);
  const currencies = new Set([...payments, ...refunds, ...orders, ...bookings, ...commission].map((row) => row._id).filter(Boolean));
  const money = [...currencies].map((currency) => {
    const item = emptyMoney(currency); const payment = payments.find((row) => row._id === currency); const refund = refunds.find((row) => row._id === currency);
    const order = orders.find((row) => row._id === currency); const booking = bookings.find((row) => row._id === currency); const commissionRow = commission.find((row) => row._id === currency);
    item.grossSalesMinor = payment?.gross || 0; item.refundsMinor = refund?.amount || 0; item.netSalesMinor = Math.max(item.grossSalesMinor - item.refundsMinor, 0);
    item.orders = order?.count || 0; item.bookings = booking?.count || 0; item.customers = new Set([...(order?.customers || []), ...(booking?.customers || [])].map(String)).size;
    item.platformRevenueMinor = commissionRow?.amount || 0;
    item.businessEarningsMinor = sellerCredit.filter((row) => row._id.currency === currency).reduce((sum, row) => sum + (row._id.type === 'seller_debit' ? -row.amount : row.amount), 0);
    item.discountsUsed = redemptions[0]?.used || 0; item.discountsMinor = redemptions[0]?.amount || 0; item.aovMinor = item.orders + item.bookings ? Math.round(item.grossSalesMinor / (item.orders + item.bookings)) : 0;
    return item;
  });
  return { currencies: money, primary: money[0] || emptyMoney(null) };
}

async function aggregateDaily(businessId, range, membership, entityType = null, locationId = null) {
  const filter = { scope: 'business', businessId: oid(businessId), dateKey: { $gte: dateKey(range.from), $lte: dateKey(new Date(range.to.getTime() - 1)) }, ...(entityType ? { entityType } : {}), ...locationClause(membership, locationId, 'locationId') };
  return AnalyticsDailyAggregate.aggregate([{ $match: filter }, { $group: { _id: '$dateKey', views: { $sum: '$views' }, uniqueViews: { $sum: '$uniqueViews' }, searches: { $sum: '$searches' }, searchClicks: { $sum: '$searchClicks' }, saves: { $sum: '$saves' }, addsToCart: { $sum: '$addsToCart' }, checkouts: { $sum: '$checkouts' }, orders: { $sum: '$orders' }, bookings: { $sum: '$bookings' }, completedOrders: { $sum: '$completedOrders' }, completedBookings: { $sum: '$completedBookings' }, promotionImpressions: { $sum: '$promotionImpressions' }, promotionClicks: { $sum: '$promotionClicks' }, promotionConversions: { $sum: '$promotionConversions' } } }, { $sort: { _id: 1 } }]);
}

async function topEntities(businessId, range, membership, entityType, Model, locationId) {
  const filter = { scope: 'business', businessId: oid(businessId), entityType, dateKey: { $gte: dateKey(range.from), $lte: dateKey(new Date(range.to.getTime() - 1)) }, ...locationClause(membership, locationId, 'locationId') };
  const rows = await AnalyticsDailyAggregate.aggregate([{ $match: filter }, { $group: { _id: '$entityId', views: { $sum: '$views' }, uniqueViews: { $sum: '$uniqueViews' }, saves: { $sum: '$saves' }, addsToCart: { $sum: '$addsToCart' }, orders: { $sum: '$orders' }, bookings: { $sum: '$bookings' } } }, { $sort: { views: -1, orders: -1 } }, { $limit: 10 }]);
  const entities = await Model.find({ _id: { $in: rows.map((row) => row._id).filter(Boolean) }, businessId: oid(businessId) }).select('name slug').lean();
  return rows.map((row) => ({
    ...row,
    id: row._id?.toString(),
    conversionRate: row.views > 0 ? Number((((entityType === 'product' ? row.orders : row.bookings) / row.views) * 100).toFixed(2)) : 0,
    entity: entities.find((item) => item._id.toString() === row._id?.toString()) || null
  })).map(({ _id, ...row }) => row);
}

async function locations(businessId, range, membership) {
  const locationIds = selectedLocationIds(membership, null);
  const filter = { businessIds: oid(businessId), paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range), ...(locationIds ? { fulfillmentLocationId: { $in: locationIds } } : {}) };
  const rows = await Order.aggregate([{ $match: filter }, { $group: { _id: '$fulfillmentLocationId', orders: { $sum: 1 }, revenue: { $sum: '$totalMinor' } } }]);
  const branches = await BusinessLocation.find({ businessId: oid(businessId), ...(locationIds ? { _id: { $in: locationIds } } : {}) }).select('name code address.city').lean();
  return branches.map((branch) => ({ id: branch._id.toString(), name: branch.name, city: branch.address?.city || null, ...(rows.find((row) => row._id?.toString() === branch._id.toString()) ? { ...rows.find((row) => row._id.toString() === branch._id.toString()), _id: undefined } : { orders: 0, revenue: 0 }) }));
}

async function promotions(businessId, range) {
  const campaigns = await PromotionCampaign.find({ businessId: oid(businessId) }).select('_id name status').lean();
  if (!campaigns.length) return [];
  return PromotionDailyAggregate.aggregate([{ $match: { campaignId: { $in: campaigns.map((item) => item._id) }, dateKey: { $gte: dateKey(range.from), $lte: dateKey(new Date(range.to.getTime() - 1)) } } }, { $group: { _id: '$campaignId', impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' }, conversions: { $sum: '$conversions' }, spendMinor: { $sum: '$spendMinor' } } }, { $sort: { impressions: -1 } }, { $limit: 20 }]).then((rows) => rows.map((row) => ({ ...row, campaign: campaigns.find((item) => item._id.toString() === row._id.toString()) || null })));
}

async function getRangeData(businessId, membership, query = {}) {
  const range = parseRange(query); const locationId = query.locationId || null;
  const entitlements = await entitlementService.getEffectiveEntitlements(businessId); const advanced = Boolean(entitlements.effective[ENTITLEMENTS.ADVANCED_ANALYTICS_ENABLED]?.value); const customerInsights = Boolean(entitlements.effective[ENTITLEMENTS.CUSTOMER_INSIGHTS_ENABLED]?.value);
  const [money, trend, products, services, branches, promotionRows] = await Promise.all([aggregateMoney(businessId, range, membership, locationId), aggregateDaily(businessId, range, membership, null, locationId), topEntities(businessId, range, membership, 'product', Product, locationId), topEntities(businessId, range, membership, 'service', Service, locationId), locations(businessId, range, membership), promotions(businessId, range)]);
  const previous = await aggregateMoney(businessId, { from: range.previousFrom, to: range.previousTo }, membership, locationId);
  return { range: { from: range.from, to: range.to, label: range.label }, comparison: { from: range.previousFrom, to: range.previousTo, metrics: previous.primary }, metrics: money.primary, currencies: money.currencies, trend, topProducts: products, topServices: services, branches, promotions: promotionRows, advanced, customerInsights, asOf: new Date() };
}

async function getOverview(businessId, membership, query) { return getRangeData(businessId, membership, query); }
async function getSales(businessId, membership, query) { const result = await getRangeData(businessId, membership, query); return { range: result.range, metrics: result.metrics, currencies: result.currencies, comparison: result.comparison, trend: result.trend }; }
async function getProducts(businessId, membership, query) { const result = await getRangeData(businessId, membership, query); return { range: result.range, products: result.topProducts, advanced: result.advanced }; }
async function getServices(businessId, membership, query) { const result = await getRangeData(businessId, membership, query); return { range: result.range, services: result.topServices, advanced: result.advanced }; }
async function getLocations(businessId, membership, query) { const result = await getRangeData(businessId, membership, query); return { range: result.range, locations: result.branches, advanced: result.advanced }; }
async function getCustomers(businessId, membership, query) {
  const result = await getRangeData(businessId, membership, query); if (!result.customerInsights) throw new AppError(403, 'FEATURE_NOT_INCLUDED', 'Customer insights are not included in the current business plan', { entitlement: ENTITLEMENTS.CUSTOMER_INSIGHTS_ENABLED, upgradeRequired: true });
  const range = parseRange(query);
  const orderFilter = { businessIds: oid(businessId), paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range), ...locationClause(membership, query.locationId, 'fulfillmentLocationId') };
  const bookingFilter = { businessId: oid(businessId), paymentStatus: { $in: ['successful', 'refunded', 'partially_refunded'] }, ...inRange(range), ...locationClause(membership, query.locationId, 'locationId') };
  const previousOrderFilter = { ...orderFilter, createdAt: { $lt: range.from } };
  const previousBookingFilter = { ...bookingFilter, createdAt: { $lt: range.from } };
  const [[orderCustomerIds, bookingCustomerIds], [previousOrderIds, previousBookingIds]] = await Promise.all([
    Promise.all([Order.distinct('customerId', orderFilter), Booking.distinct('customerId', bookingFilter)]),
    Promise.all([Order.distinct('customerId', previousOrderFilter), Booking.distinct('customerId', previousBookingFilter)])
  ]);
  const customerIds = new Set([...orderCustomerIds, ...bookingCustomerIds].map(String));
  const previousIds = new Set([...previousOrderIds, ...previousBookingIds].map(String));
  const returningCustomers = [...customerIds].filter((id) => previousIds.has(id)).length;
  return { range: result.range, total: customerIds.size, newCustomers: customerIds.size - returningCustomers, returningCustomers, source: 'paid_or_completed_orders_and_bookings' };
}

module.exports = { getOverview, getSales, getProducts, getServices, getLocations, getCustomers, aggregateMoney, aggregateDaily, parseRange };
