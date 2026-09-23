const mongoose = require('mongoose');

const adminInvitationSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  roles: { type: [{ type: String, required: true }], required: true, validate: [(roles) => roles.length > 0, 'At least one role is required'] },
  tokenHash: { type: String, required: true, unique: true, select: false },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'accepted', 'expired', 'revoked'], default: 'pending', index: true },
  acceptedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

adminInvitationSchema.index({ email: 1, status: 1, createdAt: -1 });

adminInvitationSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), email: this.email, firstName: this.firstName, lastName: this.lastName, roles: this.roles, invitedBy: this.invitedBy?.toString() || null, expiresAt: this.expiresAt, status: this.status, acceptedAt: this.acceptedAt, createdAt: this.createdAt };
};

const AdminInvitation = mongoose.model('AdminInvitation', adminInvitationSchema);

module.exports = { AdminInvitation };
