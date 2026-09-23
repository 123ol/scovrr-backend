const mongoose = require('mongoose');

function idOf(value) {
  return value?._id?.toString() || value?.toString() || null;
}

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  actorType: { type: String, enum: ['admin', 'system', 'user'], default: 'admin', index: true },
  action: { type: String, required: true, trim: true, maxlength: 120, index: true },
  targetType: { type: String, required: true, trim: true, maxlength: 80, index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  correlationId: { type: String, trim: true, maxlength: 160, default: null, index: true },
  reason: { type: String, trim: true, maxlength: 2_000, default: null },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: { type: String, trim: true, maxlength: 120, default: null },
  userAgent: { type: String, trim: true, maxlength: 512, default: null }
}, { timestamps: true, versionKey: false });

auditLogSchema.index({ createdAt: -1 });

auditLogSchema.pre('save', function immutableAudit(next) {
  if (!this.isNew) return next(new Error('Audit logs are immutable'));
  return next();
});
auditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany'], function immutableAuditQuery(next) {
  return next(new Error('Audit logs are immutable'));
});

auditLogSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    actorId: idOf(this.actorId),
    actorType: this.actorType,
    action: this.action,
    targetType: this.targetType,
    targetId: idOf(this.targetId),
    businessId: idOf(this.businessId),
    correlationId: this.correlationId,
    reason: this.reason,
    before: this.before,
    after: this.after,
    metadata: this.metadata,
    ipAddress: this.ipAddress,
    userAgent: this.userAgent,
    createdAt: this.createdAt
  };
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = { AuditLog };
