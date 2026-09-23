const mongoose = require('mongoose');

const JOB_STATUSES = ['queued', 'processing', 'completed', 'dead'];

const jobSchema = new mongoose.Schema({
  type: { type: String, required: true, trim: true, maxlength: 100, index: true },
  idempotencyKey: { type: String, trim: true, maxlength: 240, unique: true, sparse: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: JOB_STATUSES, default: 'queued', index: true },
  attempts: { type: Number, min: 0, default: 0 },
  maxAttempts: { type: Number, min: 1, max: 20, default: 5 },
  nextRunAt: { type: Date, default: Date.now, index: true },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: String, trim: true, maxlength: 120, default: null },
  lastError: { type: String, trim: true, maxlength: 1_000, default: null },
  completedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

jobSchema.index({ status: 1, nextRunAt: 1 });

const Job = mongoose.model('Job', jobSchema);

module.exports = { Job, JOB_STATUSES };
