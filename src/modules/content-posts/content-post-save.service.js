const { AppError } = require('../../common/errors/AppError');
const { ContentPost } = require('./content-post.model');
const { ContentPostSave } = require('./content-post-save.model');

async function assertPublicPost(postId) {
  const post = await ContentPost.findOne({ _id: postId, status: 'active', moderationStatus: 'approved' }).select('_id');
  if (!post) throw new AppError(404, 'CONTENT_POST_NOT_FOUND', 'Content post not found');
  return post;
}

async function add(userId, postId) {
  await assertPublicPost(postId);
  return ContentPostSave.findOneAndUpdate({ userId, postId }, { $setOnInsert: { userId, postId } }, { upsert: true, new: true });
}

async function remove(userId, postId) {
  await ContentPostSave.deleteOne({ userId, postId });
}

async function viewerSaveIds(posts, viewerId) {
  if (!viewerId || !posts.length) return new Set();
  const saves = await ContentPostSave.find({ userId: viewerId, postId: { $in: posts.map((post) => post._id) } }).select('postId').lean();
  return new Set(saves.map((save) => save.postId.toString()));
}

module.exports = { add, remove, viewerSaveIds };
