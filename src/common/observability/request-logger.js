const crypto = require('node:crypto');
const { logger } = require('./logger');
const { recordRequest } = require('./performance-metrics');
const { recordRequestUsage } = require('./resource-metrics');
const { env } = require('../../config/env');

function isSlowRequest(durationMs, thresholdMs = env.slowRequestMs) {
  return Number.isFinite(durationMs) && durationMs >= thresholdMs;
}

function requestLogger(req, res, next) {
  const requestId = crypto.randomUUID();
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const slow = isSlowRequest(durationMs);
    recordRequest({ durationMs, slow });
    recordRequestUsage();
    const context = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2))
    };
    if (res.statusCode >= 500) logger.error('http.request.completed', context);
    else if (res.statusCode >= 400) logger.warn('http.request.completed', context);
    else logger.info('http.request.completed', context);
    if (slow) {
      logger.warn('http.request.slow', { ...context, thresholdMs: env.slowRequestMs });
    }
  });
  next();
}

module.exports = { requestLogger, isSlowRequest };
