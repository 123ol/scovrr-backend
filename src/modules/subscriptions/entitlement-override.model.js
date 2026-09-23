const mongoose = require('mongoose');

const OVERRIDE_STATUSES = ['active', 'revoked', 'expired'];
const overrideSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  entitlementKey: { type: String, required: true, trim: true, maxlength: 120 },
  operation: { type: String, enum: ['replace', 'add'], default: 'replace' },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  reason: { type: String, required: true, trim: true, maxlength: 1_000 },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, default: null, index: true },
  createdByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  revokedByAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedAt: { type: Date, default: null },
  status: { type: String, enum: OVERRIDE_STATUSES, default: 'active', index: true }
}, { timestamps: true, versionKey: false });
overrideSchema.index({ businessId: 1, entitlementKey: 1, status: 1, startsAt: 1, endsAt: 1 });
overrideSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), businessId: this.businessId.toString(), entitlementKey: this.entitlementKey, operation: this.operation, value: this.value, reason: this.reason, startsAt: this.startsAt, endsAt: this.endsAt, createdByAdminId: this.createdByAdminId.toString(), revokedByAdminId: this.revokedByAdminId?.toString() || null, revokedAt: this.revokedAt, status: this.status, createdAt: this.createdAt, updatedAt: this.updatedAt }; };
const EntitlementOverride = mongoose.models.EntitlementOverride || mongoose.model('EntitlementOverride', overrideSchema);
module.exports = { EntitlementOverride, OVERRIDE_STATUSES };
