const mongoose = require('mongoose');

const MODERATION_SUBJECT_TYPES = ['business', 'product', 'service', 'content_post', 'review', 'portfolio_item'];
const MODERATION_SOURCES = ['report', 'admin', 'automated', 'verification', 'system'];
const MODERATION_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const MODERATION_STATUSES = ['pending', 'under_review', 'action_required', 'approved', 'rejected', 'removed', 'dismissed'];

const decisionSchema = new mongoose.Schema({
  outcome: { type: String, enum: MODERATION_STATUSES, default: null },
  note: { type: String, trim: true, maxlength: 4_000, default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null },
  subjectStatusBefore: { type: String, trim: true, maxlength: 40, default: null },
  subjectModerationStatusBefore: { type: String, trim: true, maxlength: 40, default: null }
}, { _id: false });

const moderationCaseSchema = new mongoose.Schema({
  caseNumber: { type: String, required: true, unique: true, index: true },
  subjectType: { type: String, enum: MODERATION_SUBJECT_TYPES, required: true, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  activeSubjectKey: { type: String, unique: true, sparse: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  source: { type: String, enum: MODERATION_SOURCES, required: true, index: true },
  sourceReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null, index: true },
  reason: { type: String, trim: true, maxlength: 120, required: true },
  severity: { type: String, enum: MODERATION_SEVERITIES, default: 'medium', index: true },
  status: { type: String, enum: MODERATION_STATUSES, default: 'pending', index: true },
  assignedModeratorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  decision: { type: decisionSchema, default: () => ({}) },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

moderationCaseSchema.index({ subjectType: 1, subjectId: 1, status: 1 });
moderationCaseSchema.index({ severity: 1, status: 1, createdAt: -1 });

moderationCaseSchema.methods.toSafeJSON = function toSafeJSON() {
  const idOf = (value) => value?._id?.toString() || value?.toString() || null;
  return {
    id: this._id.toString(),
    caseNumber: this.caseNumber,
    subjectType: this.subjectType,
    subjectId: idOf(this.subjectId),
    businessId: idOf(this.businessId),
    source: this.source,
    sourceReportId: idOf(this.sourceReportId),
    reason: this.reason,
    severity: this.severity,
    status: this.status,
    assignedModeratorId: idOf(this.assignedModeratorId),
    decision: this.decision,
    resolvedAt: this.resolvedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const ModerationCase = mongoose.model('ModerationCase', moderationCaseSchema);

module.exports = { ModerationCase, MODERATION_SUBJECT_TYPES, MODERATION_SOURCES, MODERATION_SEVERITIES, MODERATION_STATUSES };
