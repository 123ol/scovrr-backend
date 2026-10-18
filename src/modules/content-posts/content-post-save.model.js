const mongoose = require('mongoose');

const contentPostSaveSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  postId: { type: mongoose.Schema.Types.ObjectId, ref: 'ContentPost', required: true, index: true }
}, { timestamps: true, versionKey: false });

contentPostSaveSchema.index({ userId: 1, postId: 1 }, { unique: true });
contentPostSaveSchema.index({ postId: 1, createdAt: -1 });

const ContentPostSave = mongoose.model('ContentPostSave', contentPostSaveSchema);

module.exports = { ContentPostSave };
