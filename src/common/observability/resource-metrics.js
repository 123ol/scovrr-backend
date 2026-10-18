const state = {
  requests: 0,
  databaseCommands: 0,
  jobsProcessed: 0,
  jobFailures: 0,
  cpuBaseline: process.cpuUsage()
};

function recordRequestUsage() {
  state.requests += 1;
}

function recordDatabaseUsage() {
  state.databaseCommands += 1;
}

function recordJobUsage({ failed = false } = {}) {
  state.jobsProcessed += 1;
  if (failed) state.jobFailures += 1;
}

function getResourceUsageSnapshot() {
  const cpu = process.cpuUsage(state.cpuBaseline);
  return {
    scope: 'process_local',
    persistent: false,
    uptimeSeconds: Math.round(process.uptime()),
    memoryRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    cpu: {
      userSeconds: Number((cpu.user / 1_000_000).toFixed(3)),
      systemSeconds: Number((cpu.system / 1_000_000).toFixed(3))
    },
    activity: {
      requests: state.requests,
      databaseCommands: state.databaseCommands,
      jobsProcessed: state.jobsProcessed,
      jobFailures: state.jobFailures
    },
    cost: {
      estimated: false,
      currency: null,
      amountMinor: null,
      reason: 'Provider pricing and billing data are not configured.'
    },
    asOf: new Date()
  };
}

function resetResourceMetrics() {
  state.requests = 0;
  state.databaseCommands = 0;
  state.jobsProcessed = 0;
  state.jobFailures = 0;
  state.cpuBaseline = process.cpuUsage();
}

module.exports = { recordRequestUsage, recordDatabaseUsage, recordJobUsage, getResourceUsageSnapshot, resetResourceMetrics };
