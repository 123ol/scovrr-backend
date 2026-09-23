const { AppError } = require('../../common/errors/AppError');
const { assertUserCanActById } = require('../users/user-status.service');
const { User } = require('../users/user.model');
const { ContentPost } = require('./content-post.model');
const { ContentPostLike } = require('./content-post-like.model');

async function assertBuyer(userId) {
  await assertUserCanActById(userId);
  const user = await User.findById(userId).select('accountType status');
  if (!user || user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account cannot like posts right now');
  if (user.accountType !== 'buyer') throw new AppError(403, 'BUYER_LIKE_REQUIRED', 'Only buyer accounts can like Discover posts');
}

async function publicPost(postId) {
  const post = await ContentPost.findOne({ _id: postId, status: 'active', moderationStatus: 'approved' }).select('_id likesCount');
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found');
  return post;
}

async function addLike(postId, userId) {
  await assertBuyer(userId);
  await publicPost(postId);
  try {
    await ContentPostLike.create({ postId, userId });
    await ContentPost.updateOne({ _id: postId }, { $inc: { likesCount: 1 } });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const post = await ContentPost.findById(postId).select('likesCount');
  return { liked: true, likesCount: post?.likesCount || 0 };
}

async function removeLike(postId, userId) {
  await assertBuyer(userId);
  await publicPost(postId);
  const result = await ContentPostLike.deleteOne({ postId, userId });
  if (result.deletedCount) await ContentPost.updateOne({ _id: postId, likesCount: { $gt: 0 } }, { $inc: { likesCount: -1 } });
  const post = await ContentPost.findById(postId).select('likesCount');
  return { liked: false, likesCount: post?.likesCount || 0 };
}

module.exports = { addLike, removeLike };
