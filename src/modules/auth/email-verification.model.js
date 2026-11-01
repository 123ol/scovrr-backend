const mongoose = require('mongoose');

const emailVerificationChallengeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254, index: true },
  purpose: { type: String, enum: ['registration'], default: 'registration', index: true },
  codeHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, min: 0, max: 5, default: 0 },
  consumedAt: { type: Date, default: null, index: true },
  resendCount: { type: Number, min: 0, default: 0 },
  resendWindowStartedAt: { type: Date, default: Date.now },
  resendAvailableAt: { type: Date, required: true },
  requestIpHash: { type: String, trim: true, maxlength: 128, default: null }
}, { timestamps: true, versionKey: false });

emailVerificationChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400 });
emailVerificationChallengeSchema.index({ userId: 1, purpose: 1, consumedAt: 1, createdAt: -1 });

const EmailVerificationChallenge = mongoose.model('EmailVerificationChallenge', emailVerificationChallengeSchema);

module.exports = { EmailVerificationChallenge };
