const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token: { type: String, required: true, trim: true, maxlength: 500 },
  platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
  deviceId: { type: String, trim: true, maxlength: 200, default: null },
  appVersion: { type: String, trim: true, maxlength: 50, default: null },
  active: { type: Boolean, default: true, index: true },
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

deviceTokenSchema.index({ userId: 1, token: 1 }, { unique: true });

const DeviceToken = mongoose.model('DeviceToken', deviceTokenSchema);

module.exports = { DeviceToken };
