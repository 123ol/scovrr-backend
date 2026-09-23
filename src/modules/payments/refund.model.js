const mongoose = require('mongoose');

const REFUND_STATUSES = ['requested', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed'];

const refundSchema = new mongoose.Schema({
  refundNumber: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessSubscription', default: null, index: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionInvoice', default: null, index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionCampaign', default: null, index: true },
  promotionFundingId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionFunding', default: null, index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  reason: { type: String, required: true, trim: true, maxlength: 1_000 },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  providerReference: { type: String, default: null },
  status: { type: String, enum: REFUND_STATUSES, default: 'requested', index: true },
  failureReason: { type: String, default: null }
}, { timestamps: true, versionKey: false });

refundSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), refundNumber: this.refundNumber, paymentId: this.paymentId.toString(), businessId: this.businessId?.toString() || null, orderId: this.orderId?.toString() || null, bookingId: this.bookingId?.toString() || null, subscriptionId: this.subscriptionId?.toString() || null, invoiceId: this.invoiceId?.toString() || null, campaignId: this.campaignId?.toString() || null, promotionFundingId: this.promotionFundingId?.toString() || null, amountMinor: this.amountMinor, currency: this.currency, reason: this.reason, providerReference: this.providerReference, status: this.status, failureReason: this.failureReason, createdAt: this.createdAt, updatedAt: this.updatedAt }; };

const Refund = mongoose.model('Refund', refundSchema);

module.exports = { Refund, REFUND_STATUSES };
