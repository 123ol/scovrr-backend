const { AppError } = require('../../common/errors/AppError');
const { Business } = require('../businesses/business.model');
const { User } = require('../users/user.model');
const { Follow } = require('./follow.model');
const { UserFollow } = require('./user-follow.model');

async function addFollow(userId, businessId) {
  const [follower, business] = await Promise.all([
    User.findOne({ _id: userId, status: 'active' }).select('accountType'),
    Business.findOne({ _id: businessId, status: 'active', moderationStatus: 'approved' })
  ]);
  if (!follower) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (follower.accountType !== 'buyer') throw new AppError(403, 'BUYER_FOLLOW_REQUIRED', 'Only buyer accounts can follow sellers');
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  return Follow.findOneAndUpdate({ userId, businessId }, { $setOnInsert: { userId, businessId } }, { upsert: true, new: true });
}

async function removeFollow(userId, businessId) { await Follow.deleteOne({ userId, businessId }); }

async function addUserFollow(followerId, followedUserId) {
  if (followerId.toString() === followedUserId.toString()) throw new AppError(400, 'CANNOT_FOLLOW_SELF', 'You cannot follow yourself');
  const follower = await User.findOne({ _id: followerId, status: 'active' }).select('accountType');
  if (!follower) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  throw new AppError(403, 'SELLER_FOLLOWING_DISABLED', 'Accounts can only follow sellers through their business profile');
}

async function removeUserFollow(followerId, followedUserId) { await UserFollow.deleteOne({ followerId, followedUserId }); }

async function listUserFollows(followerId, query) {
  const skip = (query.page - 1) * query.limit;
  const [follows, total] = await Promise.all([
    UserFollow.find({ followerId }).sort({ createdAt: -1 }).skip(skip).limit(query.limit).populate('followedUserId'),
    UserFollow.countDocuments({ followerId })
  ]);
  return { follows: follows.filter((item) => item.followedUserId).map((item) => ({ id: item._id.toString(), user: item.followedUserId.toSafeJSON(), createdAt: item.createdAt })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listFollows(userId, query) {
  const skip = (query.page - 1) * query.limit;
  const filter = { userId };
  const [follows, total] = await Promise.all([Follow.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).populate('businessId'), Follow.countDocuments(filter)]);
  return { follows: follows.filter((item) => item.businessId).map((item) => ({ id: item._id.toString(), business: item.businessId.toPublicJSON(), createdAt: item.createdAt })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

module.exports = { addFollow, removeFollow, listFollows, addUserFollow, removeUserFollow, listUserFollows };
