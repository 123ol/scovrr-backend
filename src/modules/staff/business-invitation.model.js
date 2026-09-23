const mongoose = require('mongoose');

const INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'];

const invitationSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, index: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  role: { type: String, required: true },
  permissions: { type: [String], default: [] },
  locationAccess: { mode: { type: String, enum: ['all', 'selected'], default: 'all' }, locationIds: { type: [mongoose.Schema.Types.ObjectId], default: [] } },
  tokenHash: { type: String, required: true, unique: true, select: false },
  status: { type: String, enum: INVITATION_STATUSES, default: 'pending', index: true },
  expiresAt: { type: Date, required: true, index: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptedAt: { type: Date, default: null },
  revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

invitationSchema.index({ businessId: 1, recipientEmail: 1, status: 1 });
invitationSchema.index({ status: 1, expiresAt: 1 });

invitationSchema.methods.toSafeJSON = function toSafeJSON(includeToken = false, token = null) {
  return {
    id: this._id.toString(), businessId: this.businessId.toString(), recipientEmail: this.recipientEmail,
    recipientUserId: this.recipientUserId?.toString() || null, role: this.role,
    permissions: this.permissions, locationAccess: { mode: this.locationAccess?.mode || 'all', locationIds: (this.locationAccess?.locationIds || []).map((id) => id.toString()) },
    status: this.status, expiresAt: this.expiresAt, invitedBy: this.invitedBy?.toString() || null,
    acceptedAt: this.acceptedAt, ...(includeToken && token ? { token } : {})
  };
};

const BusinessInvitation = mongoose.model('BusinessInvitation', invitationSchema);

module.exports = { BusinessInvitation, INVITATION_STATUSES };
