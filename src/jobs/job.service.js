const crypto = require('node:crypto');
const { Job } = require('./job.model');

function workerId() {
  return `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

async function enqueueJob({ type, payload = {}, idempotencyKey, runAt = new Date(), maxAttempts = 5 }) {
  if (idempotencyKey) {
    return Job.findOneAndUpdate({ idempotencyKey }, { $setOnInsert: { type, payload, idempotencyKey, nextRunAt: runAt, maxAttempts, status: 'queued' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  }
  return Job.create({ type, payload, nextRunAt: runAt, maxAttempts });
}

async function claimNextJob(lockOwner = workerId()) {
  const now = new Date();
  const staleAt = new Date(Date.now() - 5 * 60 * 1_000);
  return Job.findOneAndUpdate({ $or: [{ status: 'queued', nextRunAt: { $lte: now } }, { status: 'processing', lockedAt: { $lte: staleAt } }] }, { $set: { status: 'processing', lockedAt: now, lockedBy: lockOwner, lastError: null }, $inc: { attempts: 1 } }, { sort: { nextRunAt: 1, createdAt: 1 }, new: true });
}

async function completeJob(jobId, lockOwner) {
  return Job.findOneAndUpdate({ _id: jobId, status: 'processing', lockedBy: lockOwner }, { $set: { status: 'completed', completedAt: new Date(), lockedAt: null, lockedBy: null }, $unset: { lastError: 1 } }, { new: true });
}

async function failJob(jobId, lockOwner, error) {
  const job = await Job.findOne({ _id: jobId, status: 'processing', lockedBy: lockOwner });
  if (!job) return null;
  const terminal = job.attempts >= job.maxAttempts;
  const delayMs = Math.min(15 * 60 * 1_000, 1_000 * (2 ** Math.max(job.attempts - 1, 0)));
  job.status = terminal ? 'dead' : 'queued';
  job.nextRunAt = new Date(Date.now() + delayMs);
  job.lockedAt = null;
  job.lockedBy = null;
  job.lastError = error?.message || String(error);
  await job.save();
  return job;
}

module.exports = { enqueueJob, claimNextJob, completeJob, failJob, workerId };
