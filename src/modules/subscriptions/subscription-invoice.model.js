const mongoose = require('mongoose');

const INVOICE_STATUSES = ['draft', 'open', 'paid', 'failed', 'void', 'refunded'];
const invoiceSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessSubscription', required: true, index: true },
  planVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanVersion', required: true },
  invoiceNumber: { type: String, required: true, unique: true, index: true },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  subtotalMinor: { type: Number, required: true, min: 0 },
  totalMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: INVOICE_STATUSES, default: 'open', index: true },
  dueAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });
invoiceSchema.index({ businessId: 1, createdAt: -1 });
invoiceSchema.index({ subscriptionId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });
invoiceSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), businessId: this.businessId.toString(), subscriptionId: this.subscriptionId.toString(), planVersionId: this.planVersionId.toString(), invoiceNumber: this.invoiceNumber, periodStart: this.periodStart, periodEnd: this.periodEnd, subtotalMinor: this.subtotalMinor, totalMinor: this.totalMinor, currency: this.currency, status: this.status, dueAt: this.dueAt, paidAt: this.paidAt, paymentId: this.paymentId?.toString() || null, createdAt: this.createdAt, updatedAt: this.updatedAt }; };
const SubscriptionInvoice = mongoose.models.SubscriptionInvoice || mongoose.model('SubscriptionInvoice', invoiceSchema);
module.exports = { SubscriptionInvoice, INVOICE_STATUSES };
