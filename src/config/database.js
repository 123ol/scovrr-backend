const mongoose = require('mongoose');
const { env } = require('./env');
const { logger } = require('../common/observability/logger');
const { recordDatabase } = require('../common/observability/performance-metrics');
const { recordDatabaseUsage } = require('../common/observability/resource-metrics');

let monitoringListenersInstalled = false;

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

async function connectDatabase() {
  if (!env.mongodbUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  mongoose.connection.on('connected', () => logger.info('database.connected'));
  mongoose.connection.on('error', (error) => logger.error('database.error', { error: { name: error.name, code: error.code, message: error.message } }));
  mongoose.connection.on('disconnected', () => logger.warn('database.disconnected'));
  installDatabaseMonitoring();

  await mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 10_000,
    monitorCommands: env.databaseCommandMonitoringEnabled
  });
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase, databaseOperationContext };
