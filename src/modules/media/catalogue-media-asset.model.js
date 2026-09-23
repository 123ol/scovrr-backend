const mongoose = require('mongoose');

const catalogueMediaAssetSchema = new mongoose.Schema({
  uploadSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogueUploadSession', required: true, unique: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  provider: { type: String, required: true, maxlength: 80 },
  publicId: { type: String, required: true, maxlength: 500 },
  url: { type: String, required: true, maxlength: 2_000 },
  mimeType: { type: String, required: true, maxlength: 100 },
  format: { type: String, required: true, maxlength: 30 },
  bytes: { type: Number, required: true, min: 1 },
  alt: { type: String, trim: true, maxlength: 200, default: null }
}, { timestamps: true, versionKey: false });

catalogueMediaAssetSchema.index({ businessId: 1, publicId: 1 }, { unique: true });

const CatalogueMediaAsset = mongoose.model('CatalogueMediaAsset', catalogueMediaAssetSchema);

module.exports = { CatalogueMediaAsset };
