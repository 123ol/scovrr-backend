const { AppError } = require('../../common/errors/AppError');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Business } = require('../businesses/business.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { Review } = require('./review.model');
const { assertUserCanActById } = require('../users/user-status.service');

async function eligibleTransaction(userId, input) {
  if (input.targetType === 'product') {
    const order = await Order.findOne({ _id: input.orderId, customerId: userId, paymentStatus: { $in: ['successful', 'partially_refunded'] }, status: { $in: ['delivered', 'completed'] }, 'items.productId': input.targetId });
    if (!order) throw new AppError(403, 'REVIEW_TRANSACTION_REQUIRED', 'Only completed purchases can be reviewed');
    const item = order.items.find((candidate) => candidate.productId.toString() === input.targetId.toString());
    return { orderId: order._id, businessId: item.businessId, productId: input.targetId };
  }
  const booking = await Booking.findOne({ _id: input.bookingId, customerId: userId, paymentStatus: { $in: ['successful', 'partially_refunded'] }, status: 'completed', serviceId: input.targetId });
  if (!booking) throw new AppError(403, 'REVIEW_TRANSACTION_REQUIRED', 'Only completed bookings can be reviewed');
  return { bookingId: booking._id, businessId: booking.businessId, serviceId: input.targetId };
}

async function refreshAggregates(targetType, targetId) {
  const filter = { targetType, status: 'approved', ...(targetType === 'product' ? { productId: targetId } : { serviceId: targetId }) };
  const aggregate = await Review.aggregate([{ $match: filter }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  const average = aggregate[0]?.average || 0;
  const count = aggregate[0]?.count || 0;
  const Target = targetType === 'product' ? Product : Service;
  const target = await Target.findByIdAndUpdate(targetId, { $set: { ratingAverage: Number(average.toFixed(2)), ratingCount: count } }, { new: true });
  if (target) {
    const businessAggregate = await Review.aggregate([{ $match: { businessId: target.businessId?._id || target.businessId, status: 'approved' } }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]);
    await Business.findByIdAndUpdate(target.businessId?._id || target.businessId, { $set: { ratingAverage: Number((businessAggregate[0]?.average || 0).toFixed(2)), ratingCount: businessAggregate[0]?.count || 0 } });
  }
}

async function createReview(userId, input) {
  await assertUserCanActById(userId);
  const transaction = await eligibleTransaction(userId, input);
  const existing = await Review.findOne({ reviewerId: userId, ...(transaction.productId ? { orderId: transaction.orderId, productId: transaction.productId } : { bookingId: transaction.bookingId, serviceId: transaction.serviceId }) });
  if (existing) throw new AppError(409, 'REVIEW_ALREADY_EXISTS', 'You have already reviewed this transaction');
  const review = await Review.create({ reviewerId: userId, targetType: input.targetType, ...transaction, rating: input.rating, text: input.text || '', media: input.media || [], status: 'approved' });
  await refreshAggregates(input.targetType, input.targetId);
  return review;
}

async function listReviews(targetType, targetId, query) {
  const filter = { targetType, status: 'approved', ...(targetType === 'product' ? { productId: targetId } : { serviceId: targetId }) };
  const skip = (query.page - 1) * query.limit;
  const [reviews, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Review.countDocuments(filter)]);
  return { reviews: reviews.map((review) => review.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listBusinessReviews(businessId, query) {
  const filter = { businessId, status: 'approved' };
  const skip = (query.page - 1) * query.limit;
  const [reviews, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Review.countDocuments(filter)]);
  return { reviews: reviews.map((review) => review.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function respondToReview(businessId, userId, reviewId, text) {
  await assertUserCanActById(userId);
  const membership = await BusinessMembership.findOne({ businessId, userId, status: 'active', permissions: { $in: ['business.manage', 'customers.manage', '*'] } });
  if (!membership) throw new AppError(403, 'BUSINESS_PERMISSION_REQUIRED', 'You do not have permission to respond to this review');
  const review = await Review.findOne({ _id: reviewId, businessId, status: 'approved' });
  if (!review) throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
  review.businessResponse = { text, respondedBy: userId, respondedAt: new Date() };
  await review.save();
  return review;
}

module.exports = { createReview, listReviews, listBusinessReviews, respondToReview, refreshAggregates, eligibleTransaction };
