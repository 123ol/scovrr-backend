const mongoose = require('mongoose');

const CATALOGUE_UPLOAD_STATUSES = ['pending', 'uploaded', 'expired', 'revoked'];

const catalogueUploadSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  provider: { type: String, required: true, maxlength: 40 },
  expectedProviderAssetId: { type: String, required: true, maxlength: 500 },
  mimeType: { type: String, required: true, maxlength: 120 },
  maxBytes: { type: Number, required: true, min: 1 },
  status: { type: String, enum: CATALOGUE_UPLOAD_STATUSES, default: 'pending', index: true },
  media: { url: String, publicId: String, provider: String, format: String, bytes: Number, alt: String },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, versionKey: false });

catalogueUploadSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CatalogueUploadSession = mongoose.model('CatalogueUploadSession', catalogueUploadSessionSchema);

module.exports = { CatalogueUploadSession, CATALOGUE_UPLOAD_STATUSES };
