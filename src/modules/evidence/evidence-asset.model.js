const mongoose = require('mongoose');

const EVIDENCE_PURPOSES = ['report', 'dispute', 'message', 'verification', 'delivery'];
const EVIDENCE_STATUSES = ['uploaded', 'attached', 'hidden', 'revoked'];
const EVIDENCE_VISIBILITIES = ['parties', 'admin_only', 'submitter_and_admin'];

const evidenceAssetSchema = new mongoose.Schema({
  purpose: { type: String, enum: EVIDENCE_PURPOSES, required: true, index: true },
  contextSubjectType: { type: String, default: null },
  contextSubjectId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', default: null, index: true },
  subjectType: { type: String, enum: ['report', 'dispute', 'message', 'verification', 'delivery'], default: null, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceUploadSession', required: true, unique: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, required: true, maxlength: 40 },
  providerAssetId: { type: String, required: true, maxlength: 500 },
  storageKey: { type: String, required: true, maxlength: 500 },
  version: { type: Number, default: null },
  type: { type: String, enum: ['image', 'document'], required: true },
  mimeType: { type: String, required: true, maxlength: 120 },
  format: { type: String, maxlength: 40, default: null },
  sizeBytes: { type: Number, min: 1, required: true },
  originalName: { type: String, trim: true, maxlength: 180, default: null },
  alt: { type: String, trim: true, maxlength: 200, default: null },
  visibility: { type: String, enum: EVIDENCE_VISIBILITIES, required: true },
  status: { type: String, enum: EVIDENCE_STATUSES, default: 'uploaded', index: true },
  attachedAt: { type: Date, default: null },
  hiddenAt: { type: Date, default: null },
  retentionExpiresAt: { type: Date, default: null, index: true }
}, { timestamps: true, versionKey: false });

evidenceAssetSchema.index({ subjectType: 1, subjectId: 1, status: 1, createdAt: -1 });
evidenceAssetSchema.index({ uploadedBy: 1, status: 1, createdAt: -1 });
evidenceAssetSchema.index({ retentionExpiresAt: 1, status: 1 });

evidenceAssetSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    purpose: this.purpose,
    subjectType: this.subjectType,
    subjectId: this.subjectId?.toString() || null,
    uploadedBy: this.uploadedBy.toString(),
    provider: this.provider,
    type: this.type,
    mimeType: this.mimeType,
    format: this.format,
    sizeBytes: this.sizeBytes,
    originalName: this.originalName,
    alt: this.alt,
    visibility: this.visibility,
    status: this.status,
    attachedAt: this.attachedAt,
    createdAt: this.createdAt
  };
};

const EvidenceAsset = mongoose.model('EvidenceAsset', evidenceAssetSchema);

module.exports = { EvidenceAsset, EVIDENCE_PURPOSES, EVIDENCE_STATUSES, EVIDENCE_VISIBILITIES };
