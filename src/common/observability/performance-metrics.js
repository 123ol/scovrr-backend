const MAX_SAMPLES = 200;

const state = {
  requests: [],
  database: [],
  slowRequests: 0,
  slowDatabaseQueries: 0,
  failedDatabaseQueries: 0
};

function addSample(collection, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  collection.push(Number(durationMs.toFixed(2)));
  if (collection.length > MAX_SAMPLES) collection.shift();
}

function recordRequest({ durationMs, slow = false } = {}) {
  addSample(state.requests, durationMs);
  if (slow) state.slowRequests += 1;
}

function recordDatabase({ durationMs, slow = false, failed = false } = {}) {
  addSample(state.database, durationMs);
  if (slow) state.slowDatabaseQueries += 1;
  if (failed) state.failedDatabaseQueries += 1;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function summarize(values) {
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null
  };
}

function getPerformanceSnapshot() {
  return {
    scope: 'process_local',
    sampleLimit: MAX_SAMPLES,
    requests: summarize(state.requests),
    database: summarize(state.database),
    signals: {
      slowRequests: state.slowRequests,
      slowDatabaseQueries: state.slowDatabaseQueries,
      failedDatabaseQueries: state.failedDatabaseQueries
    },
    asOf: new Date()
  };
}

function resetPerformanceMetrics() {
  state.requests.length = 0;
  state.database.length = 0;
  state.slowRequests = 0;
  state.slowDatabaseQueries = 0;
  state.failedDatabaseQueries = 0;
}

module.exports = { MAX_SAMPLES, recordRequest, recordDatabase, getPerformanceSnapshot, resetPerformanceMetrics };
