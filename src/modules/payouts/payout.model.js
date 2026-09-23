const mongoose = require('mongoose');

const PAYOUT_STATUSES = ['pending', 'eligible', 'queued', 'processing', 'paid', 'failed', 'held', 'reversed'];

const payoutSchema = new mongoose.Schema({
  payoutNumber: { type: String, required: true, unique: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  sourcePaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true, index: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: PAYOUT_STATUSES, default: 'pending', index: true },
  eligibleAt: { type: Date, required: true, index: true },
  provider: { type: String, default: 'paystack', trim: true, maxlength: 80 },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  providerReference: { type: String, unique: true, sparse: true, index: true, default: null },
  attemptCount: { type: Number, min: 0, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  failureReason: { type: String, default: null },
  holdReason: { type: String, default: null }
}, { timestamps: true, versionKey: false });

payoutSchema.index({ businessId: 1, status: 1, createdAt: -1 });

payoutSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), payoutNumber: this.payoutNumber, businessId: this.businessId.toString(), sourcePaymentId: this.sourcePaymentId.toString(), amountMinor: this.amountMinor, currency: this.currency, status: this.status, eligibleAt: this.eligibleAt, provider: this.provider, providerReference: this.providerReference, attemptCount: this.attemptCount, lastAttemptAt: this.lastAttemptAt, paidAt: this.paidAt, failureReason: this.failureReason, holdReason: this.holdReason, createdAt: this.createdAt, updatedAt: this.updatedAt }; };

const Payout = mongoose.model('Payout', payoutSchema);

module.exports = { Payout, PAYOUT_STATUSES };
