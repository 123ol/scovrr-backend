const state = {
  serverStartedAt: null,
  adapter: 'unknown',
  connectedSockets: 0,
  totalConnections: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null
};

function markSocketServerStarted(adapter = 'unknown') {
  state.serverStartedAt = new Date();
  state.adapter = String(adapter || 'unknown').slice(0, 80);
}

function markSocketConnected() {
  state.connectedSockets += 1;
  state.totalConnections += 1;
  state.lastConnectedAt = new Date();
}

function markSocketDisconnected() {
  state.connectedSockets = Math.max(0, state.connectedSockets - 1);
  state.lastDisconnectedAt = new Date();
}

function getSocketRuntimeSnapshot() {
  return {
    transport: 'socket.io',
    enabled: Boolean(state.serverStartedAt),
    adapter: state.adapter,
    connectedSockets: state.connectedSockets,
    totalConnections: state.totalConnections,
    scope: 'process_local',
    persistent: false,
    serverStartedAt: state.serverStartedAt,
    lastConnectedAt: state.lastConnectedAt,
    lastDisconnectedAt: state.lastDisconnectedAt
  };
}

function resetSocketRuntimeMetrics() {
  state.serverStartedAt = null;
  state.adapter = 'unknown';
  state.connectedSockets = 0;
  state.totalConnections = 0;
  state.lastConnectedAt = null;
  state.lastDisconnectedAt = null;
}

module.exports = { markSocketServerStarted, markSocketConnected, markSocketDisconnected, getSocketRuntimeSnapshot, resetSocketRuntimeMetrics };
