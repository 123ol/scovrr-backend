const mongoose = require('mongoose');

const ACCOUNT_EXPORT_JOB_STATUSES = ['queued', 'processing', 'completed', 'failed'];

const accountExportJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ACCOUNT_EXPORT_JOB_STATUSES, default: 'queued', index: true },
  document: { type: mongoose.Schema.Types.Mixed, default: null },
  errorCode: { type: String, trim: true, maxlength: 120, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, versionKey: false });

accountExportJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
accountExportJobSchema.index({ userId: 1, status: 1, createdAt: -1 });

accountExportJobSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    status: this.status,
    document: this.status === 'completed' ? this.document : null,
    errorCode: this.status === 'failed' ? this.errorCode : null,
    startedAt: this.startedAt,
    completedAt: this.completedAt,
    expiresAt: this.expiresAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const AccountExportJob = mongoose.models.AccountExportJob || mongoose.model('AccountExportJob', accountExportJobSchema);

module.exports = { AccountExportJob, ACCOUNT_EXPORT_JOB_STATUSES };
