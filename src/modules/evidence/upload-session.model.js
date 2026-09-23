const mongoose = require('mongoose');

const UPLOAD_SESSION_STATUSES = ['pending', 'uploaded', 'consumed', 'expired', 'revoked'];

const uploadSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  purpose: { type: String, enum: ['report', 'dispute', 'message'], required: true },
  contextSubjectType: { type: String, default: null },
  contextSubjectId: { type: mongoose.Schema.Types.ObjectId, default: null },
  disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', default: null },
  provider: { type: String, required: true, maxlength: 40 },
  expectedProviderAssetId: { type: String, required: true, maxlength: 500 },
  mimeType: { type: String, required: true, maxlength: 120 },
  maxBytes: { type: Number, required: true, min: 1 },
  status: { type: String, enum: UPLOAD_SESSION_STATUSES, default: 'pending', index: true },
  evidenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceAsset', default: null },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

uploadSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const EvidenceUploadSession = mongoose.model('EvidenceUploadSession', uploadSessionSchema);

module.exports = { EvidenceUploadSession, UPLOAD_SESSION_STATUSES };
