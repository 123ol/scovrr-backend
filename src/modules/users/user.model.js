const mongoose = require('mongoose');

const USER_STATUSES = ['active', 'suspended', 'deactivated', 'pending_verification'];
const ACCOUNT_TYPES = ['buyer', 'seller'];
const ADMIN_ROLES = ['super_admin', 'operations', 'customer_support', 'moderator', 'verification_admin', 'finance_admin', 'marketing_admin', 'analytics_admin', 'verification', 'moderation', 'finance', 'support'];

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true, maxlength: 80 },
  lastName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 254 },
  phone: { type: String, trim: true, unique: true, sparse: true, maxlength: 32 },
  passwordHash: { type: String, required: true, select: false },
  accountType: { type: String, enum: ACCOUNT_TYPES, default: 'buyer', index: true },
  status: { type: String, enum: USER_STATUSES, default: 'active', index: true },
  adminRoles: { type: [{ type: String, enum: ADMIN_ROLES }], default: [] },
  emailVerifiedAt: { type: Date, default: null },
  phoneVerifiedAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

userSchema.methods.toSafeJSON = function toSafeJSON(options = {}) {
  const safeUser = {
    id: this._id.toString(),
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    phone: this.phone || null,
    accountType: this.accountType,
    status: this.status,
    emailVerified: Boolean(this.emailVerifiedAt),
    phoneVerified: Boolean(this.phoneVerifiedAt),
    createdAt: this.createdAt
  };

  if (options.includeAdmin) safeUser.adminRoles = this.adminRoles;
  return safeUser;
};

const User = mongoose.model('User', userSchema);

module.exports = { User, USER_STATUSES, ACCOUNT_TYPES, ADMIN_ROLES };
