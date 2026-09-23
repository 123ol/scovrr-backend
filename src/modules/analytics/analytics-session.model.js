const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true, trim: true, maxlength: 120 },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  anonymous: { type: Boolean, default: true, index: true },
  platform: { type: String, enum: ['ios', 'android', 'web', 'admin', 'server'], default: 'server' },
  appVersion: { type: String, trim: true, maxlength: 40, default: null },
  country: { type: String, trim: true, maxlength: 120, default: null },
  state: { type: String, trim: true, maxlength: 120, default: null },
  city: { type: String, trim: true, maxlength: 120, default: null },
  startedAt: { type: Date, default: Date.now, index: true },
  lastActivityAt: { type: Date, default: Date.now },
  eventCount: { type: Number, min: 0, max: 10_000, default: 0 }
}, { timestamps: true, versionKey: false });
sessionSchema.index({ userId: 1, lastActivityAt: -1 });
sessionSchema.index({ lastActivityAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

const AnalyticsSession = mongoose.model('AnalyticsSession', sessionSchema);
module.exports = { AnalyticsSession };
