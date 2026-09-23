const mongoose = require('mongoose');

const EVENT_TYPES = ['impression', 'click', 'conversion'];
const EVENT_STATUSES = ['accepted', 'rejected', 'duplicate'];

const eventSchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionCampaign', required: true, index: true },
  targetType: { type: String, enum: ['BUSINESS', 'PRODUCT', 'SERVICE'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  placement: { type: String, required: true, index: true },
  type: { type: String, enum: EVENT_TYPES, required: true, index: true },
  status: { type: String, enum: EVENT_STATUSES, default: 'accepted', index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorHash: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true },
  spendMinor: { type: Number, min: 0, default: 0 },
  conversionId: { type: String, default: null, index: true },
  aggregated: { type: Boolean, default: false, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  expiresAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

eventSchema.index({ campaignId: 1, type: 1, createdAt: -1 });
eventSchema.index({ campaignId: 1, actorHash: 1, type: 1, createdAt: -1 });
eventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PromotionEvent = mongoose.model('PromotionEvent', eventSchema);

module.exports = { PromotionEvent, EVENT_TYPES, EVENT_STATUSES };
