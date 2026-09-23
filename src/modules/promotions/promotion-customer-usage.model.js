const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema({
  promotionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Promotion', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reservedCount: { type: Number, min: 0, default: 0 },
  usageCount: { type: Number, min: 0, default: 0 },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

usageSchema.index({ promotionId: 1, customerId: 1 }, { unique: true });
const PromotionCustomerUsage = mongoose.model('PromotionCustomerUsage', usageSchema);
module.exports = { PromotionCustomerUsage };
