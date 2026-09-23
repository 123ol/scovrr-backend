const mongoose = require('mongoose');

const FUNDING_STATUSES = ['initialized', 'pending', 'verified', 'failed', 'partially_refunded', 'refunded'];

const fundingSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionCampaign', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, unique: true, sparse: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: FUNDING_STATUSES, default: 'initialized', index: true },
  refundedMinor: { type: Number, min: 0, default: 0 },
  verifiedAt: { type: Date, default: null },
  failureReason: { type: String, trim: true, maxlength: 500, default: null }
}, { timestamps: true, versionKey: false });

fundingSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), campaignId: this.campaignId.toString(), businessId: this.businessId.toString(), paymentId: this.paymentId?.toString() || null, idempotencyKey: this.idempotencyKey, amountMinor: this.amountMinor, currency: this.currency, status: this.status, refundedMinor: this.refundedMinor, verifiedAt: this.verifiedAt, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const PromotionFunding = mongoose.model('PromotionFunding', fundingSchema);

module.exports = { PromotionFunding, FUNDING_STATUSES };
