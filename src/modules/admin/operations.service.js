const mongoose = require('mongoose');
const { Job } = require('../../jobs/job.model');
const { AppError } = require('../../common/errors/AppError');
const { sanitizeErrorMessage, monitoringEndpoint } = require('../../common/observability/logger');
const { getErrorMonitoringSnapshot } = require('../../common/observability/error-monitoring-metrics');
const { getPerformanceSnapshot } = require('../../common/observability/performance-metrics');
const { getSocketRuntimeSnapshot } = require('../../common/observability/socket-metrics');
const { getIndexHealth } = require('../../common/observability/index-health');
const { getSchedulerRuntimeSnapshot } = require('../../common/observability/scheduler-metrics');
const { getResourceUsageSnapshot } = require('../../common/observability/resource-metrics');

function safeDeadJob(job) {
  return {
    id: job._id.toString(),
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextRunAt: job.nextRunAt,
    lastError: job.lastError ? sanitizeErrorMessage(job.lastError) : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || null
  };
}

async function getOperationsHealth() {
  const [queued, processing, dead, oldestQueued] = await Promise.all([
    Job.countDocuments({ status: 'queued' }),
    Job.countDocuments({ status: 'processing' }),
    Job.countDocuments({ status: 'dead' }),
    Job.findOne({ status: 'queued' }).sort({ nextRunAt: 1, createdAt: 1 }).select('nextRunAt').lean()
  ]);
  const databaseConnected = mongoose.connection.readyState === 1;
  return {
    status: databaseConnected ? 'ok' : 'degraded',
    database: databaseConnected ? 'connected' : 'disconnected',
    queue: { queued, processing, dead, oldestQueuedAt: oldestQueued?.nextRunAt || null },
    process: { uptimeSeconds: Math.round(process.uptime()), memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)) },
    performance: getPerformanceSnapshot(),
    resources: getResourceUsageSnapshot(),
    monitoring: getErrorMonitoringSnapshot({ configured: Boolean(monitoringEndpoint()) }),
    scheduler: getSchedulerRuntimeSnapshot(),
    socket: getSocketRuntimeSnapshot(),
    indexes: await getIndexHealth(),
    asOf: new Date()
  };
}

async function listDeadJobs({ page = 1, limit = 25 } = {}) {
  const skip = (page - 1) * limit;
  const [jobs, total] = await Promise.all([
    Job.find({ status: 'dead' }).sort({ updatedAt: -1, createdAt: -1 }).skip(skip).limit(limit).select('_id type status attempts maxAttempts nextRunAt lastError createdAt updatedAt completedAt').lean(),
    Job.countDocuments({ status: 'dead' })
  ]);
  return { jobs: jobs.map(safeDeadJob), total, page, limit, pages: Math.ceil(total / limit) };
}

async function replayDeadJob(jobId) {
  if (!mongoose.isValidObjectId(jobId)) throw new AppError(400, 'INVALID_JOB_ID', 'The job identifier is invalid');
  const job = await Job.findOneAndUpdate(
    { _id: jobId, status: 'dead' },
    { $set: { status: 'queued', attempts: 0, nextRunAt: new Date(), lockedAt: null, lockedBy: null } },
    { new: true }
  ).select('_id type status attempts maxAttempts nextRunAt lastError createdAt updatedAt completedAt');
  if (!job) throw new AppError(409, 'JOB_NOT_REPLAYABLE', 'Only a dead job can be replayed');
  return safeDeadJob(job);
}

module.exports = { getOperationsHealth, listDeadJobs, replayDeadJob, safeDeadJob };
