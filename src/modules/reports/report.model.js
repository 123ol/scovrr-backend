const mongoose = require('mongoose');
const { evidenceSnapshotSchema } = require('../evidence/evidence-snapshot');

function idOf(value) {
  return value?._id?.toString() || value?.toString() || null;
}

function safeEvidence(items = []) { return items.map((item) => ({ evidenceId: idOf(item.evidenceId), type: item.type, mimeType: item.mimeType, sizeBytes: item.sizeBytes, alt: item.alt || null, visibility: item.visibility, addedAt: item.addedAt })); }

const REPORT_SUBJECT_TYPES = ['business', 'product', 'service', 'review', 'user', 'message', 'conversation', 'order', 'booking'];
const REPORT_REASONS = ['counterfeit', 'fraud', 'misleading_content', 'inappropriate_media', 'prohibited_goods', 'spam', 'harassment', 'safety', 'payment_issue', 'privacy', 'fake_review', 'abusive_behaviour', 'privacy_violation', 'other'];
const REPORT_STATUSES = ['open', 'in_review', 'action_required', 'resolved', 'dismissed', 'rejected'];
const REPORT_PRIORITIES = ['low', 'normal', 'high', 'critical'];

const evidenceSchema = evidenceSnapshotSchema;

const reportSchema = new mongoose.Schema({
  reportNumber: { type: String, unique: true, sparse: true, index: true },
  reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  subjectType: { type: String, enum: REPORT_SUBJECT_TYPES, required: true, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  details: { type: String, trim: true, maxlength: 2_000, default: '' },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  evidence: { type: [evidenceSchema], default: [] },
  status: { type: String, enum: REPORT_STATUSES, default: 'open', index: true },
  priority: { type: String, enum: REPORT_PRIORITIES, default: 'normal', index: true },
  assignedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  moderationCaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'ModerationCase', default: null, index: true },
  resolution: { type: String, trim: true, maxlength: 2_000, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

reportSchema.index({ subjectType: 1, subjectId: 1, status: 1, createdAt: -1 });
reportSchema.index({ priority: 1, status: 1, createdAt: -1 });
reportSchema.index({ assignedAdminId: 1, status: 1, createdAt: -1 });
reportSchema.index({ businessId: 1, status: 1, createdAt: -1 });

reportSchema.methods.toSafeJSON = function toSafeJSON(options = {}) {
  const result = {
    id: this._id.toString(),
    reportNumber: this.reportNumber || null,
    reporterId: idOf(this.reporterId),
    subjectType: this.subjectType,
    subjectId: idOf(this.subjectId),
    businessId: idOf(this.businessId),
    reason: this.reason,
    details: this.details,
    evidence: options.includeEvidence ? safeEvidence(this.evidence) : [],
    status: this.status,
    priority: this.priority,
    resolution: this.resolution,
    resolvedAt: this.resolvedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
  if (options.audience === 'admin') {
    result.assignedAdminId = idOf(this.assignedAdminId);
    result.moderationCaseId = idOf(this.moderationCaseId);
    result.resolvedBy = idOf(this.resolvedBy);
  }
  return result;
};

const Report = mongoose.model('Report', reportSchema);

module.exports = { Report, REPORT_SUBJECT_TYPES, REPORT_REASONS, REPORT_STATUSES, REPORT_PRIORITIES, evidenceSchema };
