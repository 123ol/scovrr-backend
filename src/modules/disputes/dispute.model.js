const mongoose = require('mongoose');
const { evidenceSnapshotSchema } = require('../evidence/evidence-snapshot');

function idOf(value) {
  return value?._id?.toString() || value?.toString() || null;
}

function safeEvidence(items = []) { return items.map((item) => ({ evidenceId: idOf(item.evidenceId), type: item.type, mimeType: item.mimeType, sizeBytes: item.sizeBytes, alt: item.alt || null, visibility: item.visibility, addedAt: item.addedAt })); }

const DISPUTE_REASONS = ['item_not_received', 'item_not_as_described', 'incorrect_product', 'wrong_item', 'damaged_item', 'missing_item', 'partial_delivery', 'delivery_problem', 'seller_unresponsive', 'service_not_delivered', 'service_not_as_described', 'service_quality', 'seller_absent', 'professional_no_show', 'professional_misconduct', 'customer_no_show', 'booking_cancelled_unfairly', 'refund_not_received', 'payment_issue', 'fraud', 'other'];
const DISPUTE_STATUSES = ['open', 'awaiting_business_response', 'awaiting_customer_response', 'under_review', 'resolved_customer', 'resolved_business', 'partial_resolution', 'resolved', 'rejected', 'closed', 'cancelled'];

const timelineEntrySchema = new mongoose.Schema({
  status: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  note: { type: String, trim: true, maxlength: 2_000, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const disputeSchema = new mongoose.Schema({
  disputeNumber: { type: String, required: true, unique: true, index: true },
  activeTransactionKey: { type: String, unique: true, sparse: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  targetType: { type: String, enum: ['order', 'booking'], required: true },
  transactionType: { type: String, enum: ['order', 'booking'], default: null, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  reason: { type: String, enum: DISPUTE_REASONS, required: true },
  description: { type: String, required: true, trim: true, maxlength: 4_000 },
  disputedAmountMinor: { type: Number, min: 1, default: null },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: null },
  evidence: { type: [evidenceSnapshotSchema], default: [] },
  status: { type: String, enum: DISPUTE_STATUSES, default: 'open', index: true },
  assignedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  openedAt: { type: Date, default: Date.now, index: true },
  responseDeadline: { type: Date, default: null },
  businessResponse: { description: { type: String, trim: true, maxlength: 4_000 }, evidence: { type: [evidenceSnapshotSchema], default: [] }, proposedResolution: { type: String, trim: true, maxlength: 1_000, default: null }, respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, respondedAt: Date },
  adminDecision: { outcome: { type: String, enum: ['refund_full', 'refund_partial', 'no_refund', 'account_action', 'other'] }, note: { type: String, trim: true, maxlength: 4_000 }, decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, decidedAt: Date },
  resolution: { type: { type: String, enum: ['full_refund', 'partial_refund', 'release_to_business', 'no_financial_action', 'recovery_required'], default: null }, amountMinor: { type: Number, min: 0, default: null }, refundId: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund', default: null }, note: { type: String, maxlength: 4_000, default: null } },
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  financialState: { type: String, enum: ['not_held', 'held', 'released', 'recovery_required'], default: 'not_held', index: true },
  payoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout', default: null },
  financialHold: { type: Boolean, default: false },
  timeline: { type: [timelineEntrySchema], default: [] }
}, { timestamps: true, versionKey: false });

disputeSchema.index({ customerId: 1, targetType: 1, orderId: 1, bookingId: 1, status: 1 });
disputeSchema.index({ businessId: 1, status: 1, createdAt: -1 });
disputeSchema.index({ transactionType: 1, status: 1, createdAt: -1 });
disputeSchema.index({ assignedAdminId: 1, status: 1, createdAt: -1 });

// Legacy clients may still write the embedded timeline. Keep it bounded while new events use DisputeEvent.
disputeSchema.pre('save', function boundLegacyTimeline(next) {
  if (this.timeline?.length > 50) this.timeline = this.timeline.slice(-50);
  next();
});

disputeSchema.methods.toSafeJSON = function toSafeJSON(options = {}) {
  const isAdmin = options.audience === 'admin';
  const result = { id: this._id.toString(), disputeNumber: this.disputeNumber, customerId: idOf(this.customerId), businessId: idOf(this.businessId), targetType: this.targetType, transactionType: this.transactionType || this.targetType, orderId: idOf(this.orderId), bookingId: idOf(this.bookingId), reason: this.reason, description: this.description, disputedAmountMinor: this.disputedAmountMinor, currency: this.currency, evidence: options.includeEvidence === false ? [] : safeEvidence(this.evidence), status: this.status, responseDeadline: this.responseDeadline, businessResponse: this.businessResponse ? { description: this.businessResponse.description, evidence: options.includeEvidence === false ? [] : safeEvidence(this.businessResponse.evidence), proposedResolution: this.businessResponse.proposedResolution, respondedAt: this.businessResponse.respondedAt } : null, resolution: this.resolution ? { type: this.resolution.type, amountMinor: this.resolution.amountMinor, note: this.resolution.note } : null, resolvedAt: this.resolvedAt, timeline: (this.timeline || []).map((entry) => ({ status: entry.status, note: entry.note, createdAt: entry.createdAt })), createdAt: this.createdAt, updatedAt: this.updatedAt };
  if (isAdmin) {
    result.assignedAdminId = idOf(this.assignedAdminId);
    const businessResponse = this.businessResponse?.toObject ? this.businessResponse.toObject() : this.businessResponse;
    result.businessResponse = businessResponse ? { ...businessResponse, evidence: safeEvidence(this.businessResponse.evidence) } : null;
    result.adminDecision = this.adminDecision;
    result.resolution = this.resolution;
    result.financialState = this.financialState;
    result.payoutId = idOf(this.payoutId);
    result.financialHold = this.financialHold;
    result.timeline = this.timeline;
  }
  return result;
};

const Dispute = mongoose.model('Dispute', disputeSchema);

module.exports = { Dispute, DISPUTE_REASONS, DISPUTE_STATUSES };
