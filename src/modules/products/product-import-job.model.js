const mongoose = require('mongoose');

const PRODUCT_IMPORT_JOB_STATUSES = ['queued', 'processing', 'completed', 'failed'];

const productImportJobSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: PRODUCT_IMPORT_JOB_STATUSES, default: 'queued', index: true },
  drafts: { type: mongoose.Schema.Types.Mixed, required: true, select: false },
  validated: { type: Number, min: 0, default: 0 },
  created: { type: Number, min: 0, default: 0 },
  createdProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  errorCode: { type: String, trim: true, maxlength: 120, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, versionKey: false });

productImportJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
productImportJobSchema.index({ businessId: 1, createdAt: -1 });

productImportJobSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    status: this.status,
    validated: this.validated,
    created: this.created,
    createdProductIds: this.createdProductIds.map((id) => id.toString()),
    errorCode: this.status === 'failed' ? this.errorCode : null,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    expiresAt: this.expiresAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const ProductImportJob = mongoose.models.ProductImportJob || mongoose.model('ProductImportJob', productImportJobSchema);

module.exports = { ProductImportJob, PRODUCT_IMPORT_JOB_STATUSES };
