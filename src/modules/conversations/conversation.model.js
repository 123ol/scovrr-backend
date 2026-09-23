const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participantIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], required: true, validate: [(items) => items.length >= 2 && items.length <= 10, 'A conversation must have between two and ten participants'] },
  conversationKey: { type: String, unique: true, sparse: true, select: false, maxlength: 500 },
  contextType: { type: String, enum: ['product', 'service', 'order', 'booking', 'business'], default: 'business' },
  contextId: { type: mongoose.Schema.Types.ObjectId, default: null },
  contextSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  lastMessagePreview: { type: String, default: '' },
  lastMessageAt: { type: Date, default: null },
  archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true, versionKey: false });

conversationSchema.index({ participantIds: 1, updatedAt: -1 });
conversationSchema.index({ contextType: 1, contextId: 1 });

conversationSchema.methods.toSafeJSON = function toSafeJSON(userId) {
  return { id: this._id.toString(), participantIds: this.participantIds.map((id) => id.toString()), contextType: this.contextType, contextId: this.contextId?.toString() || null, contextSnapshot: this.contextSnapshot, lastMessagePreview: this.lastMessagePreview, lastMessageAt: this.lastMessageAt, archived: this.archivedBy.some((id) => id.toString() === userId?.toString()), createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = { Conversation };
