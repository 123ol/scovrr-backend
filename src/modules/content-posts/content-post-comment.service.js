const { AppError } = require('../../common/errors/AppError');
const { assertUserCanActById } = require('../users/user-status.service');
const { User } = require('../users/user.model');
const { ContentPost } = require('./content-post.model');
const { ContentPostComment } = require('./content-post-comment.model');

async function publicPost(postId) {
  const post = await ContentPost.findOne({ _id: postId, status: 'active', moderationStatus: 'approved' }).select('_id');
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found');
  return post;
}

async function listComments(postId, query) {
  await publicPost(postId);
  const filter = { postId, status: 'active' };
  const skip = (query.page - 1) * query.limit;
  const [comments, total] = await Promise.all([
    ContentPostComment.find(filter).sort({ createdAt: 1 }).skip(skip).limit(query.limit).populate('authorId', 'firstName lastName accountType'),
    ContentPostComment.countDocuments(filter)
  ]);
  return { comments: comments.map((comment) => comment.toPublicJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function businessPost(businessId, postId) {
  const post = await ContentPost.findOne({ _id: postId, businessId }).select('_id');
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found for this business');
  return post;
}

async function parentComment(postId, parentCommentId) {
  if (!parentCommentId) return null;
  const parent = await ContentPostComment.findOne({ _id: parentCommentId, postId, status: 'active' }).select('_id');
  if (!parent) throw new AppError(400, 'COMMENT_PARENT_NOT_FOUND', 'The comment you are replying to is no longer available');
  return parent._id;
}

async function createComment(postId, userId, body, parentCommentId = null) {
  await assertUserCanActById(userId);
  const user = await User.findById(userId).select('accountType status firstName lastName');
  if (!user || user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account cannot comment right now');
  if (user.accountType !== 'buyer') throw new AppError(403, 'BUYER_COMMENT_REQUIRED', 'Only buyer accounts can comment on Discover posts');
  await publicPost(postId);
  const parent = await parentComment(postId, parentCommentId);
  const comment = await ContentPostComment.create({ postId, parentCommentId: parent, authorId: userId, body });
  await ContentPost.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } });
  await comment.populate('authorId', 'firstName lastName accountType');
  return comment;
}

async function listBusinessComments(businessId, postId, query) {
  await businessPost(businessId, postId);
  const filter = { postId, status: 'active' };
  const skip = (query.page - 1) * query.limit;
  const [comments, total] = await Promise.all([
    ContentPostComment.find(filter).sort({ createdAt: 1 }).skip(skip).limit(query.limit).populate('authorId', 'firstName lastName accountType'),
    ContentPostComment.countDocuments(filter)
  ]);
  return { comments: comments.map((comment) => comment.toPublicJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function createBusinessComment(businessId, postId, userId, body, parentCommentId = null) {
  await assertUserCanActById(userId);
  await businessPost(businessId, postId);
  const parent = await parentComment(postId, parentCommentId);
  const comment = await ContentPostComment.create({ postId, parentCommentId: parent, authorId: userId, body });
  await ContentPost.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } });
  await comment.populate('authorId', 'firstName lastName accountType');
  return comment;
}

module.exports = { listComments, createComment, listBusinessComments, createBusinessComment };
