const mongoose = require('mongoose');

const BILLING_ATTEMPT_STATUSES = ['initialized', 'pending', 'successful', 'failed', 'abandoned'];
const billingAttemptSchema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessSubscription', required: true, index: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionInvoice', required: true, index: true },
  attemptNumber: { type: Number, required: true, min: 1 },
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  providerReference: { type: String, default: null, index: true },
  amountMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: BILLING_ATTEMPT_STATUSES, default: 'initialized', index: true },
  errorCategory: { type: String, default: null },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });
billingAttemptSchema.index({ subscriptionId: 1, invoiceId: 1, attemptNumber: 1 }, { unique: true });
billingAttemptSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), subscriptionId: this.subscriptionId.toString(), invoiceId: this.invoiceId.toString(), attemptNumber: this.attemptNumber, providerReference: this.providerReference, amountMinor: this.amountMinor, currency: this.currency, status: this.status, errorCategory: this.errorCategory, startedAt: this.startedAt, completedAt: this.completedAt, createdAt: this.createdAt, updatedAt: this.updatedAt }; };
const SubscriptionBillingAttempt = mongoose.models.SubscriptionBillingAttempt || mongoose.model('SubscriptionBillingAttempt', billingAttemptSchema);
module.exports = { SubscriptionBillingAttempt, BILLING_ATTEMPT_STATUSES };
