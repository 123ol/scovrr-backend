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
    ContentPostComment.find(filter).sort({ createdAt: 1 }).skip(skip).limit(query.limit).populate('authorId', 'firstName lastName'),
    ContentPostComment.countDocuments(filter)
  ]);
  return { comments: comments.map((comment) => comment.toPublicJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function createComment(postId, userId, body) {
  await assertUserCanActById(userId);
  const user = await User.findById(userId).select('accountType status firstName lastName');
  if (!user || user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account cannot comment right now');
  if (user.accountType !== 'buyer') throw new AppError(403, 'BUYER_COMMENT_REQUIRED', 'Only buyer accounts can comment on Discover posts');
  await publicPost(postId);
  const comment = await ContentPostComment.create({ postId, authorId: userId, body });
  await ContentPost.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } });
  await comment.populate('authorId', 'firstName lastName');
  return comment;
}

module.exports = { listComments, createComment };
