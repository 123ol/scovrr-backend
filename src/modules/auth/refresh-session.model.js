const mongoose = require('mongoose');

const refreshSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'RefreshSession', default: null },
  userAgent: { type: String, maxlength: 512 },
  ipAddress: { type: String, maxlength: 128 },
  deviceLabel: { type: String, trim: true, maxlength: 120, default: null },
  platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
  lastUsedAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

refreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshSession = mongoose.model('RefreshSession', refreshSessionSchema);

module.exports = { RefreshSession };
