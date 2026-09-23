const mongoose = require('mongoose');

const evidenceSnapshotSchema = new mongoose.Schema({
  evidenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceAsset', default: null },
  storageKey: { type: String, trim: true, maxlength: 500, default: null },
  type: { type: String, enum: ['image', 'document'], default: 'image' },
  mimeType: { type: String, trim: true, maxlength: 120, default: null },
  sizeBytes: { type: Number, min: 0, max: 25 * 1024 * 1024, default: null },
  alt: { type: String, trim: true, maxlength: 200, default: null },
  visibility: { type: String, enum: ['parties', 'admin_only', 'submitter_and_admin'], default: 'parties' },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

function evidenceSnapshot(asset) {
  return {
    evidenceId: asset._id,
    storageKey: asset.storageKey,
    type: asset.type,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    alt: asset.alt || null,
    visibility: asset.visibility,
    addedAt: new Date()
  };
}

module.exports = { evidenceSnapshotSchema, evidenceSnapshot };
