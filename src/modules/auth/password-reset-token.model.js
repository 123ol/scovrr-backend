const mongoose = require('mongoose');

const passwordResetTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  requestIpHash: { type: String, trim: true, maxlength: 128, default: null }
}, { timestamps: true, versionKey: false });

passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });
passwordResetTokenSchema.index({ userId: 1, usedAt: 1, createdAt: -1 });

const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);

module.exports = { PasswordResetToken };
