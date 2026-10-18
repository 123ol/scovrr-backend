const mongoose = require('mongoose');

const contentPostCommentSchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPost', required: true, index: true },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPostComment', default: null, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, required: true, trim: true, maxlength: 1_000 },
  status: { type: String, enum: ['active', 'removed'], default: 'active', index: true }
}, { timestamps: true, versionKey: false });

contentPostCommentSchema.index({ postId: 1, status: 1, createdAt: -1 });
contentPostCommentSchema.index({ postId: 1, parentCommentId: 1, status: 1, createdAt: 1 });

contentPostCommentSchema.methods.toPublicJSON = function toPublicJSON() {
  const author = this.authorId && this.authorId.firstName ? {
    id: this.authorId._id.toString(),
    firstName: this.authorId.firstName,
    lastName: this.authorId.lastName
  } : null;
  return {
    id: this._id.toString(),
    parentCommentId: this.parentCommentId?.toString() || null,
    body: this.body,
    author,
    isBusinessReply: this.authorId?.accountType === 'seller',
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const ContentPostComment = mongoose.model('ContentPostComment', contentPostCommentSchema);

module.exports = { ContentPostComment };
