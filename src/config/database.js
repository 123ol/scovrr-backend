const mongoose = require('mongoose');
const { env } = require('./env');
const { logger } = require('../common/observability/logger');
const { recordDatabase } = require('../common/observability/performance-metrics');
const { recordDatabaseUsage } = require('../common/observability/resource-metrics');

let monitoringListenersInstalled = false;
let connectionListenersInstalled = false;

function databaseOperationContext(event = {}) {
  return {
    commandName: typeof event.commandName === 'string' ? event.commandName : 'unknown',
    durationMs: Number.isFinite(event.duration) ? Number(event.duration.toFixed(2)) : null
  };
}

function installDatabaseMonitoring() {
  if (monitoringListenersInstalled || !env.databaseCommandMonitoringEnabled) return;
  mongoose.connection.on('commandSucceeded', (event) => {
    const context = databaseOperationContext(event);
    const slow = context.durationMs !== null && context.durationMs >= env.slowDatabaseQueryMs;
    recordDatabase({ ...context, slow });
    recordDatabaseUsage();
    if (slow) {
      logger.warn('database.query.slow', { ...context, thresholdMs: env.slowDatabaseQueryMs });
    }
  });
  mongoose.connection.on('commandFailed', (event) => {
    const context = databaseOperationContext(event);
    recordDatabase({ ...context, failed: true });
    recordDatabaseUsage();
    logger.error('database.query.failed', context);
  });
  monitoringListenersInstalled = true;
}

function installConnectionMonitoring() {
  if (connectionListenersInstalled) return;
  mongoose.connection.on('connected', () => logger.info('database.connected'));
  mongoose.connection.on('error', (error) => logger.error('database.error', { error: { name: error.name, code: error.code, message: error.message } }));
  mongoose.connection.on('disconnected', () => logger.warn('database.disconnected'));
  connectionListenersInstalled = true;
}

function databaseOptions() {
  return {
    serverSelectionTimeoutMS: 10_000,
    monitorCommands: env.databaseCommandMonitoringEnabled,
    // Indexes are applied by the explicit migration scripts in production.
    // Keeping these options configurable preserves the development/test workflow.
    autoIndex: env.mongooseAutoIndex,
    autoCreate: env.mongooseAutoCreate
  };
}

async function connectDatabase() {
  if (!env.mongodbUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  installConnectionMonitoring();
  installDatabaseMonitoring();

  const startedAt = process.hrtime.bigint();
  await mongoose.connect(env.mongodbUri, databaseOptions());
  logger.info('database.connection.ready', {
    durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1_000_000).toFixed(2)),
    autoIndex: env.mongooseAutoIndex,
    autoCreate: env.mongooseAutoCreate
  });
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase, databaseOperationContext, databaseOptions };
