const mongoose = require('mongoose');

const aggregateSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionCampaign', required: true },
  dateKey: { type: String, required: true },
  placement: { type: String, required: true },
  impressions: { type: Number, min: 0, default: 0 },
  clicks: { type: Number, min: 0, default: 0 },
  conversions: { type: Number, min: 0, default: 0 },
  spendMinor: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

aggregateSchema.index({ campaignId: 1, dateKey: 1, placement: 1 }, { unique: true });
aggregateSchema.index({ campaignId: 1, dateKey: -1 });

const PromotionDailyAggregate = mongoose.model('PromotionDailyAggregate', aggregateSchema);

module.exports = { PromotionDailyAggregate };
