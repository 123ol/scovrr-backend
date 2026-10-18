const mongoose = require('mongoose');
const { MODERATION_SUBJECT_TYPES } = require('./moderation-case.model');

const MODERATION_APPEAL_STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'withdrawn'];

const decisionSchema = new mongoose.Schema({
  outcome: { type: String, enum: ['approved', 'rejected'], default: null },
  note: { type: String, trim: true, maxlength: 4_000, default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  decidedAt: { type: Date, default: null }
}, { _id: false });

const moderationAppealSchema = new mongoose.Schema({
  appealNumber: { type: String, required: true, unique: true, index: true },
  moderationCaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'ModerationCase', required: true, index: true },
  activeCaseKey: { type: String, unique: true, sparse: true, index: true },
  appellantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  subjectType: { type: String, enum: MODERATION_SUBJECT_TYPES, required: true, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  reason: { type: String, trim: true, required: true, maxlength: 4_000 },
  status: { type: String, enum: MODERATION_APPEAL_STATUSES, default: 'pending', index: true },
  decision: { type: decisionSchema, default: () => ({}) },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

moderationAppealSchema.index({ businessId: 1, status: 1, createdAt: -1 });
moderationAppealSchema.index({ status: 1, createdAt: -1 });

moderationAppealSchema.methods.toSafeJSON = function toSafeJSON() {
  const idOf = (value) => value?._id?.toString() || value?.toString() || null;
  return {
    id: this._id.toString(),
    appealNumber: this.appealNumber,
    moderationCaseId: idOf(this.moderationCaseId),
    appellantId: idOf(this.appellantId),
    businessId: idOf(this.businessId),
    subjectType: this.subjectType,
    subjectId: idOf(this.subjectId),
    reason: this.reason,
    status: this.status,
    decision: this.decision,
    resolvedAt: this.resolvedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const ModerationAppeal = mongoose.model('ModerationAppeal', moderationAppealSchema);

module.exports = { ModerationAppeal, MODERATION_APPEAL_STATUSES };
