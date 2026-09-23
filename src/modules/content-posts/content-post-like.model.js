const mongoose = require('mongoose');

const contentPostLikeSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPost', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
}, { timestamps: true, versionKey: false });

contentPostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

const ContentPostLike = mongoose.model('ContentPostLike', contentPostLikeSchema);

module.exports = { ContentPostLike };
