const http = require('node:http');
const { Server: SocketServer } = require('socket.io');
const { app } = require('./app');
const { env, assertRuntimeConfig } = require('./config/env');
const { connectDatabase } = require('./config/database');
const { attachSocketServer } = require('./sockets');
const { startBackgroundJobs } = require('./jobs/job-runner');
const { logger, captureException } = require('./common/observability/logger');

async function startServer() {
  assertRuntimeConfig();
  await connectDatabase();
  const httpServer = http.createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: env.corsAllowedOrigins.length ? env.corsAllowedOrigins : true, credentials: true } });
  attachSocketServer(io);
  const stopBackgroundJobs = startBackgroundJobs({ pollIntervalMs: env.jobPollIntervalMs, recurringIntervalMs: env.jobRecurringIntervalMs, autoPayouts: env.autoPayoutsEnabled, reconciliation: env.reconciliationEnabled });
  httpServer.listen(env.port, () => {
    logger.info('server.started', { port: env.port, socketIO: true, backgroundJobs: true });
  });
  return { httpServer, io, stopBackgroundJobs };
}

if (require.main === module) {
  startServer().catch((error) => {
    captureException(error, { event: 'server.start.failed' });
    process.exitCode = 1;
  });
}

// Keep the app as the default CommonJS export so Vercel can detect this file
// as an Express entrypoint if it selects src/server.js.
module.exports = app;
module.exports.app = app;
module.exports.startServer = startServer;
