const mongoose = require('mongoose');

const messageMediaSchema = new mongoose.Schema({
  evidenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceAsset', default: null },
  url: { type: String, trim: true, maxlength: 2_000, default: null },
  mimeType: { type: String, trim: true, maxlength: 120, default: null },
  alt: { type: String, trim: true, maxlength: 200, default: null }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['text', 'image', 'system'], default: 'text' },
  body: { type: String, trim: true, maxlength: 4_000, default: '' },
  media: { type: [messageMediaSchema], default: [] },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deliveredAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

messageSchema.index({ conversationId: 1, createdAt: -1 });

messageSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), conversationId: this.conversationId.toString(), senderId: this.senderId.toString(), type: this.type, body: this.body, media: this.media, readBy: this.readBy.map((id) => id.toString()), deliveredAt: this.deliveredAt, createdAt: this.createdAt }; };

const Message = mongoose.model('Message', messageSchema);

module.exports = { Message };
