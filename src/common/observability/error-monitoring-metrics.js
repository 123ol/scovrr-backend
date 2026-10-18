const state = {
  attempts: 0,
  delivered: 0,
  failed: 0,
  lastAttemptAt: null,
  lastDeliveredAt: null,
  lastFailedAt: null
};

function recordErrorMonitoringDelivery({ configured = false, delivered = false } = {}) {
  if (!configured) return;
  const timestamp = new Date().toISOString();
  state.attempts += 1;
  state.lastAttemptAt = timestamp;
  if (delivered) {
    state.delivered += 1;
    state.lastDeliveredAt = timestamp;
  } else {
    state.failed += 1;
    state.lastFailedAt = timestamp;
  }
}

function getErrorMonitoringSnapshot({ configured = false } = {}) {
  return {
    configured: Boolean(configured),
    scope: 'process_local',
    persistent: false,
    attempts: state.attempts,
    delivered: state.delivered,
    failed: state.failed,
    lastAttemptAt: state.lastAttemptAt,
    lastDeliveredAt: state.lastDeliveredAt,
    lastFailedAt: state.lastFailedAt
  };
}

function resetErrorMonitoringMetrics() {
  state.attempts = 0;
  state.delivered = 0;
  state.failed = 0;
  state.lastAttemptAt = null;
  state.lastDeliveredAt = null;
  state.lastFailedAt = null;
}

module.exports = { recordErrorMonitoringDelivery, getErrorMonitoringSnapshot, resetErrorMonitoringMetrics };
