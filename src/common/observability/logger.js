const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const { recordErrorMonitoringDelivery } = require('./error-monitoring-metrics');
const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api.?key|private.?key|credential|recipient.?code|access.?code|raw.?body/i;
const MAX_STRING_LENGTH = 2_000;

function sanitizeErrorMessage(value) {
  return String(value)
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:token|secret|password|api[_-]?key|access[_-]?code)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|api[_-]?key|access[_-]?code)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function configuredLevel() {
  const value = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : 'info';
}

function sanitize(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const safeValue = ['message', 'stack'].includes(key) ? sanitizeErrorMessage(value) : value;
    return safeValue.length > MAX_STRING_LENGTH ? `${safeValue.slice(0, MAX_STRING_LENGTH)}…` : safeValue;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, key, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey, depth + 1)]));
  }
  return String(value);
}

function serializeError(error) {
  if (!error) return null;
  const output = {
    name: error.name,
    code: error.code,
    statusCode: error.statusCode,
    message: error.message
  };
  if (process.env.NODE_ENV !== 'production' || process.env.LOG_INCLUDE_STACK === 'true') output.stack = error.stack;
  return sanitize(output, 'error');
}

function write(level, event, context = {}) {
  if (LEVELS[level] < LEVELS[configuredLevel()]) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'scovrr-api',
    environment: process.env.NODE_ENV || 'development',
    event,
    ...sanitize(context)
  };
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function monitoringEndpoint(value = process.env.ERROR_MONITORING_WEBHOOK_URL) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch (_error) {
    return null;
  }
}

function buildErrorMonitoringEvent(error, context = {}) {
  return sanitize({
    timestamp: new Date().toISOString(),
    service: 'scovrr-api',
    environment: process.env.NODE_ENV || 'development',
    event: 'error.exception',
    error: serializeError(error),
    context
  });
}

async function publishErrorMonitoringEvent(event, endpoint = monitoringEndpoint()) {
  const url = monitoringEndpoint(endpoint);
  if (!url || typeof fetch !== 'function') {
    const result = { configured: Boolean(url), delivered: false };
    recordErrorMonitoringDelivery(result);
    return result;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: controller.signal
    });
    const result = { configured: true, delivered: response.ok, statusCode: response.status };
    recordErrorMonitoringDelivery(result);
    return result;
  } catch (_error) {
    const result = { configured: true, delivered: false };
    recordErrorMonitoringDelivery(result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

const logger = Object.freeze({
  debug: (event, context) => write('debug', event, context),
  info: (event, context) => write('info', event, context),
  warn: (event, context) => write('warn', event, context),
  error: (event, context) => write('error', event, context)
});

function captureException(error, context = {}) {
  const event = buildErrorMonitoringEvent(error, context);
  logger.error('error.unhandled', { ...context, error: event.error });
  void publishErrorMonitoringEvent(event);
}

module.exports = { logger, captureException, sanitize, sanitizeErrorMessage, serializeError, monitoringEndpoint, buildErrorMonitoringEvent, publishErrorMonitoringEvent };
