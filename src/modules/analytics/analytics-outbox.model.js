const mongoose = require('mongoose');

const outboxSchema = new mongoose.Schema({
  eventKey: { type: String, required: true, unique: true, index: true, maxlength: 180 },
  eventName: { type: String, required: true, maxlength: 80, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, min: 0, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  lockedBy: { type: String, default: null, maxlength: 120 },
  lockedAt: { type: Date, default: null },
  lastError: { type: String, maxlength: 1_000, default: null },
  processedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });
outboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
outboxSchema.index({ status: 1, lockedAt: 1 });

const AnalyticsOutbox = mongoose.model('AnalyticsOutbox', outboxSchema);
module.exports = { AnalyticsOutbox };
