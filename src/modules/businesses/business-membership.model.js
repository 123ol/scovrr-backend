const mongoose = require('mongoose');

const { permissionsForRole } = require('./business-permissions');

const MEMBERSHIP_ROLES = ['owner', 'administrator', 'manager', 'inventory_manager', 'order_manager', 'order_staff', 'booking_manager', 'booking_staff', 'professional', 'customer_support', 'finance', 'finance_staff'];
const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'revoked'];

const membershipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
  permissions: { type: [{ type: String, trim: true }], default: function defaultPermissions() { return permissionsForRole(this.role); } },
  locationAccess: {
    mode: { type: String, enum: ['all', 'selected'], default: 'all' },
    locationIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation' }], default: [] }
  },
  status: { type: String, enum: MEMBERSHIP_STATUSES, default: 'active', index: true },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  joinedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

membershipSchema.index({ userId: 1, businessId: 1 }, { unique: true });

membershipSchema.methods.toJSONSafe = function toJSONSafe() {
  const businessId = this.businessId?._id || this.businessId;
  const userId = this.userId?._id || this.userId;
  return {
    id: this._id.toString(),
    businessId: businessId.toString(),
    userId: userId.toString(),
    role: this.role,
    permissions: this.permissions,
    locationAccess: { mode: this.locationAccess?.mode || 'all', locationIds: (this.locationAccess?.locationIds || []).map((id) => id.toString()) },
    status: this.status,
    joinedAt: this.joinedAt
  };
};

const BusinessMembership = mongoose.model('BusinessMembership', membershipSchema);

const { ROLE_PERMISSIONS } = require('./business-permissions');

module.exports = { BusinessMembership, MEMBERSHIP_ROLES, MEMBERSHIP_STATUSES, ROLE_PERMISSIONS, permissionsForRole };
