const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');

const { sanitize, serializeError, buildErrorMonitoringEvent, publishErrorMonitoringEvent } = require('../src/common/observability/logger');
const { getErrorMonitoringSnapshot, resetErrorMonitoringMetrics } = require('../src/common/observability/error-monitoring-metrics');
const { requestLogger, isSlowRequest } = require('../src/common/observability/request-logger');
const { databaseOperationContext } = require('../src/config/database');
const { MAX_SAMPLES, recordRequest, recordDatabase, getPerformanceSnapshot, resetPerformanceMetrics } = require('../src/common/observability/performance-metrics');
const { markSocketServerStarted, markSocketConnected, markSocketDisconnected, getSocketRuntimeSnapshot, resetSocketRuntimeMetrics } = require('../src/common/observability/socket-metrics');
const { getIndexHealth } = require('../src/common/observability/index-health');
const { markSchedulerStarted, markSchedulerStopped, markPollStarted, markPollCompleted, markPollFailed, markRecurringStarted, markRecurringCompleted, markRecurringFailed, getSchedulerRuntimeSnapshot, resetSchedulerRuntimeMetrics } = require('../src/common/observability/scheduler-metrics');
const { recordRequestUsage, recordDatabaseUsage, recordJobUsage, getResourceUsageSnapshot, resetResourceMetrics } = require('../src/common/observability/resource-metrics');
const { attachSocketServer } = require('../src/sockets');
const { startBackgroundJobs } = require('../src/jobs/job-runner');

test('structured logging redacts credential-shaped fields and bounds large values', () => {
  const result = sanitize({
    requestId: 'request-123',
    statusCode: 500,
    authorization: 'Bearer should-not-appear',
    nested: { apiKey: 'should-not-appear' },
    longValue: 'x'.repeat(2_100)
  });

  assert.equal(result.requestId, 'request-123');
  assert.equal(result.statusCode, 500);
  assert.equal(result.authorization, '[REDACTED]');
  assert.equal(result.nested.apiKey, '[REDACTED]');
  assert.equal(result.longValue.length, 2_001);
  assert.equal(result.longValue.endsWith('…'), true);

  const errorContext = sanitize({ error: { message: 'provider returned Bearer secret-value and token=hidden' } });
  assert.equal(errorContext.error.message, 'provider returned Bearer [REDACTED] and token=[REDACTED]');
});

test('production error serialization omits stack traces by default', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousIncludeStack = process.env.LOG_INCLUDE_STACK;
  process.env.NODE_ENV = 'production';
  delete process.env.LOG_INCLUDE_STACK;

  try {
    const result = serializeError(Object.assign(new Error('safe message'), { code: 'TEST_ERROR', statusCode: 500 }));
    assert.equal(result.message, 'safe message');
    assert.equal(result.code, 'TEST_ERROR');
    assert.equal(Object.hasOwn(result, 'stack'), false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousIncludeStack === undefined) delete process.env.LOG_INCLUDE_STACK;
    else process.env.LOG_INCLUDE_STACK = previousIncludeStack;
  }
});

test('request logger assigns a correlation id and response header', () => {
  const req = { method: 'GET', path: '/health' };
  const res = new EventEmitter();
  const headers = {};
  res.setHeader = (name, value) => { headers[name] = value; };
  res.statusCode = 200;
  let nextCalled = false;

  requestLogger(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.match(req.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(headers['X-Request-Id'], req.requestId);
});

test('request and database observability thresholds are bounded and credential-free', () => {
  assert.equal(isSlowRequest(1_000, 1_000), true);
  assert.equal(isSlowRequest(999, 1_000), false);
  assert.equal(isSlowRequest(Number.NaN, 1_000), false);
  assert.deepEqual(databaseOperationContext({ commandName: 'find', duration: 512.345 }), { commandName: 'find', durationMs: 512.35 });
  assert.deepEqual(databaseOperationContext({ commandName: 'find', duration: Number.NaN, command: { filter: { password: 'secret' } } }), { commandName: 'find', durationMs: null });
});

test('request logger emits a separate slow event without request payloads', () => {
  const originalClock = process.hrtime.bigint;
  const originalWrite = process.stdout.write;
  const logLines = [];
  let clockReads = 0;
  process.hrtime.bigint = () => (clockReads++ === 0 ? 0n : 1_500_000_000n);
  process.stdout.write = (line) => { logLines.push(String(line)); return true; };

  try {
    const req = { method: 'GET', path: '/api/v1/discover', body: { password: 'must-not-log' } };
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.statusCode = 200;
    requestLogger(req, res, () => {});
    res.emit('finish');
  } finally {
    process.hrtime.bigint = originalClock;
    process.stdout.write = originalWrite;
  }

  const events = logLines.map((line) => JSON.parse(line));
  const slowEvent = events.find((event) => event.event === 'http.request.slow');
  assert.equal(slowEvent.durationMs, 1_500);
  assert.equal(slowEvent.thresholdMs > 0, true);
  assert.equal(JSON.stringify(events).includes('must-not-log'), false);
});

test('error monitoring events preserve correlation context without secrets', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  resetErrorMonitoringMetrics();
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 202 };
  };

  try {
    const event = buildErrorMonitoringEvent(Object.assign(new Error('provider returned Bearer private-secret'), { code: 'PROVIDER_FAILURE', statusCode: 502 }), {
      requestId: 'request-456',
      authorization: 'Bearer private-secret'
    });
    const result = await publishErrorMonitoringEvent(event, 'https://monitoring.example.test/events');
    assert.deepEqual(result, { configured: true, delivered: true, statusCode: 202 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://monitoring.example.test/events');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['content-type'], 'application/json');
    assert.equal(requests[0].options.signal instanceof AbortSignal, true);
    assert.equal(requests[0].options.body.includes('private-secret'), false);
    assert.equal(requests[0].options.body.includes('request-456'), true);
    assert.deepEqual(getErrorMonitoringSnapshot({ configured: true }), { configured: true, scope: 'process_local', persistent: false, attempts: 1, delivered: 1, failed: 0, lastAttemptAt: getErrorMonitoringSnapshot().lastAttemptAt, lastDeliveredAt: getErrorMonitoringSnapshot().lastDeliveredAt, lastFailedAt: null });
  } finally {
    global.fetch = originalFetch;
    resetErrorMonitoringMetrics();
  }
});

test('error monitoring delivery is disabled without a valid endpoint', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('must not be called'); };
  try {
    assert.deepEqual(await publishErrorMonitoringEvent({ event: 'error.exception' }, 'not-a-url'), { configured: false, delivered: false });
  } finally {
    global.fetch = originalFetch;
  }
});

test('error monitoring diagnostics count configured delivery failures without storing payloads', async () => {
  const originalFetch = global.fetch;
  resetErrorMonitoringMetrics();
  global.fetch = async () => { throw new Error('provider secret must not escape'); };
  try {
    const result = await publishErrorMonitoringEvent({ event: 'error.exception' }, 'https://monitoring.example.test/events');
    assert.deepEqual(result, { configured: true, delivered: false });
    const snapshot = getErrorMonitoringSnapshot({ configured: true });
    assert.equal(snapshot.attempts, 1);
    assert.equal(snapshot.delivered, 0);
    assert.equal(snapshot.failed, 1);
    assert.equal(snapshot.persistent, false);
    assert.match(snapshot.lastFailedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    global.fetch = originalFetch;
    resetErrorMonitoringMetrics();
  }
});

test('performance metrics keep bounded process-local request and database summaries', () => {
  resetPerformanceMetrics();
  recordRequest({ durationMs: 30 });
  recordRequest({ durationMs: 10 });
  recordRequest({ durationMs: 90, slow: true });
  recordDatabase({ durationMs: 40, slow: true });
  recordDatabase({ durationMs: 20 });
  recordDatabase({ durationMs: 50, failed: true });
  const snapshot = getPerformanceSnapshot();
  assert.equal(snapshot.scope, 'process_local');
  assert.deepEqual(snapshot.requests, { samples: 3, p50Ms: 30, p95Ms: 90, maxMs: 90 });
  assert.deepEqual(snapshot.database, { samples: 3, p50Ms: 40, p95Ms: 50, maxMs: 50 });
  assert.deepEqual(snapshot.signals, { slowRequests: 1, slowDatabaseQueries: 1, failedDatabaseQueries: 1 });

  for (let index = 0; index < MAX_SAMPLES + 25; index += 1) recordRequest({ durationMs: index });
  assert.equal(getPerformanceSnapshot().requests.samples, MAX_SAMPLES);
  resetPerformanceMetrics();
});

test('resource metrics expose process-local usage without fabricating provider cost', () => {
  resetResourceMetrics();
  recordRequestUsage();
  recordDatabaseUsage();
  recordJobUsage();
  recordJobUsage({ failed: true });
  const snapshot = getResourceUsageSnapshot();
  assert.equal(snapshot.scope, 'process_local');
  assert.equal(snapshot.persistent, false);
  assert.deepEqual(snapshot.activity, { requests: 1, databaseCommands: 1, jobsProcessed: 2, jobFailures: 1 });
  assert.equal(snapshot.cost.estimated, false);
  assert.equal(snapshot.cost.amountMinor, null);
  assert.match(snapshot.cost.reason, /pricing/);
  assert.equal(Number.isFinite(snapshot.cpu.userSeconds), true);
  assert.equal(Number.isFinite(snapshot.memoryRssMb), true);
  resetResourceMetrics();
});

test('socket runtime diagnostics expose process-local state without claiming persistence', () => {
  resetSocketRuntimeMetrics();
  assert.equal(getSocketRuntimeSnapshot().enabled, false);
  markSocketServerStarted('in-memory');
  markSocketConnected();
  markSocketConnected();
  markSocketDisconnected();
  const snapshot = getSocketRuntimeSnapshot();
  assert.equal(snapshot.transport, 'socket.io');
  assert.equal(snapshot.adapter, 'in-memory');
  assert.equal(snapshot.connectedSockets, 1);
  assert.equal(snapshot.totalConnections, 2);
  assert.equal(snapshot.scope, 'process_local');
  assert.equal(snapshot.persistent, false);
  resetSocketRuntimeMetrics();
});

test('Socket.IO server attachment registers runtime diagnostics on the existing server boundary', () => {
  resetSocketRuntimeMetrics();
  const handlers = {};
  const io = {
    of: () => ({ adapter: null }),
    use: () => {},
    on: (event, handler) => { handlers[event] = handler; }
  };
  attachSocketServer(io);
  assert.equal(getSocketRuntimeSnapshot().enabled, true);
  assert.equal(getSocketRuntimeSnapshot().adapter, 'in-memory');
  assert.equal(typeof handlers.connection, 'function');
  resetSocketRuntimeMetrics();
});

test('index health checks the launch contract without applying indexes', async () => {
  const calls = [];
  const db = {
    collection(name) {
      calls.push(name);
      return { listIndexes: () => ({ toArray: async () => (name === 'products' ? [{ name: '_id_', key: { _id: 1 } }, { name: 'product_public_status_moderation_created', key: { status: 1, moderationStatus: 1, createdAt: -1 } }] : []) }) };
    }
  };
  const result = await getIndexHealth({
    db,
    connected: true,
    definitions: [
      { collection: 'products', name: 'product_public_status_moderation_created', key: { status: 1, moderationStatus: 1, createdAt: -1 }, options: {} },
      { collection: 'products', name: 'product_public_status_moderation_published', key: { status: 1, moderationStatus: 1, publishedAt: -1, createdAt: -1 }, options: {} }
    ]
  });

  assert.equal(result.readOnly, true);
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.summary, { expected: 2, present: 1, missing: 1, conflicts: 0, errors: 0 });
  assert.deepEqual(result.collections[0].missing, ['product_public_status_moderation_published']);
  assert.deepEqual(calls, ['products']);
});

test('index health reports disconnected databases without attempting collection access', async () => {
  let collectionCalls = 0;
  const result = await getIndexHealth({ db: { collection: () => { collectionCalls += 1; } }, connected: false, definitions: [] });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'database_disconnected');
  assert.equal(result.readOnly, true);
  assert.equal(collectionCalls, 0);
});

test('scheduler diagnostics expose process-local poll and recurring health without persistence', () => {
  resetSchedulerRuntimeMetrics();
  markSchedulerStarted();
  markPollStarted();
  markPollCompleted(3);
  markPollStarted();
  markPollFailed();
  markRecurringStarted();
  markRecurringCompleted();
  markRecurringStarted();
  markRecurringFailed();
  const snapshot = getSchedulerRuntimeSnapshot();
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.scope, 'process_local');
  assert.equal(snapshot.persistent, false);
  assert.equal(snapshot.pollRuns, 2);
  assert.equal(snapshot.pollErrors, 1);
  assert.equal(snapshot.lastPollProcessed, 3);
  assert.equal(snapshot.recurringRuns, 2);
  assert.equal(snapshot.recurringErrors, 1);
  markSchedulerStopped();
  assert.equal(getSchedulerRuntimeSnapshot().enabled, false);
  resetSchedulerRuntimeMetrics();
});

test('background scheduler feeds runtime diagnostics through the existing timer runner', async () => {
  resetSchedulerRuntimeMetrics();
  let pollCalls = 0;
  let recurringCalls = 0;
  const stop = startBackgroundJobs({
    pollIntervalMs: 5,
    recurringIntervalMs: 1_000,
    processDueJobs: async () => { pollCalls += 1; return 2; },
    scheduleRecurringJobs: async () => { recurringCalls += 1; }
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = getSchedulerRuntimeSnapshot();
    assert.equal(snapshot.enabled, true);
    assert.equal(pollCalls > 0, true);
    assert.equal(recurringCalls > 0, true);
    assert.equal(snapshot.pollRuns > 0, true);
    assert.equal(snapshot.lastPollProcessed, 2);
    assert.equal(snapshot.recurringRuns > 0, true);
  } finally {
    stop();
    assert.equal(getSchedulerRuntimeSnapshot().enabled, false);
    resetSchedulerRuntimeMetrics();
  }
});
