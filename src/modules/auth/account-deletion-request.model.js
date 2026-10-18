const mongoose = require('mongoose');

const ACCOUNT_DELETION_REQUEST_STATUSES = ['requested', 'under_review', 'rejected', 'cancelled'];

const accountDeletionRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ACCOUNT_DELETION_REQUEST_STATUSES, default: 'requested', index: true },
  reason: { type: String, trim: true, maxlength: 500, default: null },
  requestedAt: { type: Date, default: Date.now, index: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolutionReason: { type: String, trim: true, maxlength: 2_000, default: null }
}, { timestamps: true, versionKey: false });

accountDeletionRequestSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['requested', 'under_review'] } } }
);
accountDeletionRequestSchema.index({ status: 1, requestedAt: -1 });

accountDeletionRequestSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    status: this.status,
    reason: this.reason || null,
    requestedAt: this.requestedAt,
    reviewedAt: this.reviewedAt,
    resolutionReason: this.resolutionReason || null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const AccountDeletionRequest = mongoose.models.AccountDeletionRequest || mongoose.model('AccountDeletionRequest', accountDeletionRequestSchema);

module.exports = { AccountDeletionRequest, ACCOUNT_DELETION_REQUEST_STATUSES };
