const mongoose = require('mongoose');

const PAYMENT_STATUSES = ['initialized', 'pending', 'successful', 'failed', 'abandoned', 'reversed', 'refunded', 'partially_refunded'];
const PAYMENT_SETTLEMENT_STATUSES = ['pending', 'processing', 'completed', 'failed'];
const PAYMENT_TYPES = ['order', 'booking', 'subscription', 'promotion'];

const paymentSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  provider: { type: String, required: true, default: 'paystack', index: true },
  providerReference: { type: String, default: null, index: true },
  type: { type: String, enum: PAYMENT_TYPES, required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessSubscription', default: null, index: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionInvoice', default: null, index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionCampaign', default: null, index: true },
  promotionFundingId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromotionFunding', default: null, index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: PAYMENT_STATUSES, required: true, default: 'initialized', index: true },
  settlementStatus: { type: String, enum: PAYMENT_SETTLEMENT_STATUSES, default: 'pending', index: true },
  authorizationUrl: { type: String, default: null },
  accessCode: { type: String, default: null },
  refundedAmountMinor: { type: Number, default: 0, min: 0 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  failureReason: { type: String, trim: true, maxlength: 500, default: null },
  paidAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

paymentSchema.index({ customerId: 1, createdAt: -1 });

paymentSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    reference: this.reference,
    provider: this.provider,
    providerReference: this.providerReference,
    type: this.type,
    businessId: this.businessId?.toString() || null,
    orderId: this.orderId?.toString() || null,
    bookingId: this.bookingId?.toString() || null,
    subscriptionId: this.subscriptionId?.toString() || null,
    invoiceId: this.invoiceId?.toString() || null,
    campaignId: this.campaignId?.toString() || null,
    promotionFundingId: this.promotionFundingId?.toString() || null,
    amountMinor: this.amountMinor,
    currency: this.currency,
    status: this.status,
    settlementStatus: this.settlementStatus,
    authorizationUrl: this.authorizationUrl,
    accessCode: this.accessCode,
    refundedAmountMinor: this.refundedAmountMinor,
    paidAt: this.paidAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = { Payment, PAYMENT_STATUSES, PAYMENT_SETTLEMENT_STATUSES, PAYMENT_TYPES };
