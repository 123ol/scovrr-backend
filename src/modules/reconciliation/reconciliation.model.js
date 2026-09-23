const mongoose = require('mongoose');

const RECONCILIATION_STATUSES = ['matched', 'mismatch', 'action_required', 'resolved', 'ignored'];
const MISMATCH_TYPES = ['internal_settlement_missing', 'provider_status_mismatch', 'amount_mismatch', 'currency_mismatch', 'missing_provider_transaction', 'missing_internal_payment', 'duplicate_transaction', 'webhook_processing_failed', 'refund_mismatch', 'unknown'];

const reconciliationSchema = new mongoose.Schema({
  runId: { type: String, required: true, index: true },
  provider: { type: String, required: true, trim: true, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
  providerReference: { type: String, required: true, trim: true, index: true },
  internalStatus: { type: String, required: true },
  providerStatus: { type: String, default: null },
  internalAmountMinor: { type: Number, min: 0, default: 0 },
  providerAmountMinor: { type: Number, default: null },
  internalCurrency: { type: String, default: null },
  providerCurrency: { type: String, default: null },
  status: { type: String, enum: RECONCILIATION_STATUSES, required: true, index: true },
  mismatchType: { type: String, enum: MISMATCH_TYPES, default: null, index: true },
  details: { type: String, trim: true, maxlength: 2_000, default: null },
  providerPayload: { type: mongoose.Schema.Types.Mixed, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolution: { type: String, trim: true, maxlength: 2_000, default: null },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

reconciliationSchema.index({ runId: 1, paymentId: 1 }, { unique: true, partialFilterExpression: { paymentId: { $type: 'objectId' } } });
reconciliationSchema.index({ runId: 1, providerReference: 1 }, { unique: true });
reconciliationSchema.index({ provider: 1, status: 1, createdAt: -1 });

reconciliationSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), runId: this.runId, provider: this.provider, paymentId: this.paymentId?.toString() || null, providerReference: this.providerReference, internalStatus: this.internalStatus, providerStatus: this.providerStatus, internalAmountMinor: this.internalAmountMinor, providerAmountMinor: this.providerAmountMinor, internalCurrency: this.internalCurrency, providerCurrency: this.providerCurrency, status: this.status, mismatchType: this.mismatchType, details: this.details, resolvedBy: this.resolvedBy?.toString() || null, resolution: this.resolution, resolvedAt: this.resolvedAt, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const PaymentReconciliation = mongoose.model('PaymentReconciliation', reconciliationSchema);

module.exports = { PaymentReconciliation, RECONCILIATION_STATUSES, MISMATCH_TYPES };
