const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const { app } = require('../src/app');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

test('bounded public API burst remains healthy under local smoke load', async () => {
  const server = http.createServer(app);
  const port = await listen(server);
  const previousLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'error';

  try {
    const totalRequests = 120;
    const concurrency = 20;
    const results = [];
    let nextRequest = 0;

    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (true) {
        const requestNumber = nextRequest;
        nextRequest += 1;
        if (requestNumber >= totalRequests) return;

        const startedAt = performance.now();
        const response = await fetch(`http://127.0.0.1:${port}/api/v1`, { headers: { accept: 'application/json' } });
        const payload = await response.json();
        results.push({ status: response.status, success: payload.success, durationMs: performance.now() - startedAt });
      }
    }));

    const failures = results.filter((result) => result.status !== 200 || result.success !== true);
    const p95 = percentile(results.map((result) => result.durationMs), 0.95);
    assert.equal(results.length, totalRequests);
    assert.deepEqual(failures, []);
    assert.equal(Number.isFinite(p95), true);
    assert.equal(p95 < 2_000, true, `local public API p95 was ${p95.toFixed(2)}ms`);
  } finally {
    if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLogLevel;
    await close(server);
  }
});
