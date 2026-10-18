const state = {
  startedAt: null,
  stoppedAt: null,
  pollRuns: 0,
  pollErrors: 0,
  recurringRuns: 0,
  recurringErrors: 0,
  lastPollStartedAt: null,
  lastPollCompletedAt: null,
  lastPollProcessed: 0,
  lastScheduleStartedAt: null,
  lastScheduleCompletedAt: null
};

function now() {
  return new Date().toISOString();
}

function markSchedulerStarted() {
  state.startedAt = now();
  state.stoppedAt = null;
}

function markSchedulerStopped() {
  state.stoppedAt = now();
}

function markPollStarted() {
  state.pollRuns += 1;
  state.lastPollStartedAt = now();
}

function markPollCompleted(processed = 0) {
  state.lastPollCompletedAt = now();
  state.lastPollProcessed = Number.isFinite(processed) ? processed : 0;
}

function markPollFailed() {
  state.pollErrors += 1;
}

function markRecurringStarted() {
  state.recurringRuns += 1;
  state.lastScheduleStartedAt = now();
}

function markRecurringCompleted() {
  state.lastScheduleCompletedAt = now();
}

function markRecurringFailed() {
  state.recurringErrors += 1;
}

function getSchedulerRuntimeSnapshot() {
  return {
    enabled: Boolean(state.startedAt && !state.stoppedAt),
    scope: 'process_local',
    persistent: false,
    startedAt: state.startedAt,
    stoppedAt: state.stoppedAt,
    pollRuns: state.pollRuns,
    pollErrors: state.pollErrors,
    recurringRuns: state.recurringRuns,
    recurringErrors: state.recurringErrors,
    lastPollStartedAt: state.lastPollStartedAt,
    lastPollCompletedAt: state.lastPollCompletedAt,
    lastPollProcessed: state.lastPollProcessed,
    lastScheduleStartedAt: state.lastScheduleStartedAt,
    lastScheduleCompletedAt: state.lastScheduleCompletedAt
  };
}

function resetSchedulerRuntimeMetrics() {
  Object.keys(state).forEach((key) => { state[key] = key.endsWith('Runs') || key.endsWith('Errors') || key === 'lastPollProcessed' ? 0 : null; });
}

module.exports = {
  markSchedulerStarted,
  markSchedulerStopped,
  markPollStarted,
  markPollCompleted,
  markPollFailed,
  markRecurringStarted,
  markRecurringCompleted,
  markRecurringFailed,
  getSchedulerRuntimeSnapshot,
  resetSchedulerRuntimeMetrics
};
