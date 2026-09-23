const mongoose = require('mongoose');

const redemptionSchema = new mongoose.Schema({
  promotionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Promotion', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  couponCodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CouponCode', default: null },
  discountMinor: { type: Number, min: 0, default: 0 },
  idempotencyKey: { type: String, trim: true, maxlength: 240, unique: true, sparse: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['reserved', 'consumed', 'redeemed', 'released', 'voided'], default: 'reserved', index: true },
  createdAt: { type: Date, default: Date.now },
  consumedAt: { type: Date, default: null },
  releasedAt: { type: Date, default: null }
}, { versionKey: false });

redemptionSchema.index({ promotionId: 1, customerId: 1, status: 1 });
redemptionSchema.index({ orderId: 1, status: 1 });
redemptionSchema.index({ bookingId: 1, status: 1 });

const PromotionRedemption = mongoose.model('PromotionRedemption', redemptionSchema);

module.exports = { PromotionRedemption };
