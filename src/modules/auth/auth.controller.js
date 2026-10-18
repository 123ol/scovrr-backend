const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const authService = require('./auth.service');

function requestMetadata(req) {
  return {
    userAgent: req.get('user-agent'),
    ipAddress: req.ip,
    deviceLabel: req.get('x-device-name'),
    platform: req.get('x-platform') || 'unknown'
  };
}

const register = asyncHandler(async (req, res) => {
  const session = await authService.register(req.body, requestMetadata(req));
  return res.status(201).json({ success: true, data: session });
});

const login = asyncHandler(async (req, res) => {
  const session = await authService.login(req.body, requestMetadata(req));
  return sendSuccess(res, session);
});

const refresh = asyncHandler(async (req, res) => {
  const session = await authService.refresh(req.body.refreshToken, requestMetadata(req));
  return sendSuccess(res, session);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.auth.sessionId, req.auth.userId);
  return res.status(204).send();
});

const me = asyncHandler(async (req, res) => sendSuccess(res, { user: (await authService.ensureSellerAccountType(req.auth.user)).toSafeJSON() }));
const updateProfile = asyncHandler(async (req, res) => sendSuccess(res, { user: (await authService.updateProfile(req.auth.userId, req.body)).toSafeJSON() }));
const updatePreferences = asyncHandler(async (req, res) => sendSuccess(res, { user: (await authService.updateNotificationPreferences(req.auth.userId, req.body)).toSafeJSON() }));
const recordPrivacyConsent = asyncHandler(async (req, res) => sendSuccess(res, { user: (await authService.recordPrivacyConsent(req.auth.userId, req.body)).toSafeJSON() }));
const getPrivacyConsent = asyncHandler(async (req, res) => sendSuccess(res, { privacy: await authService.getPrivacyConsent(req.auth.userId) }));
const accountLifecyclePolicy = asyncHandler(async (_req, res) => sendSuccess(res, { policy: authService.getAccountLifecyclePolicy() }));
const getDeletionRequest = asyncHandler(async (req, res) => sendSuccess(res, { deletionRequest: (await authService.getAccountDeletionRequest(req.auth.userId))?.toSafeJSON() || null }));
const requestDeletion = asyncHandler(async (req, res) => res.status(202).json({ success: true, data: { policy: authService.getAccountLifecyclePolicy(), deletionRequest: (await authService.requestAccountDeletion(req.auth.userId, req.body.reason))?.toSafeJSON() } }));
const cancelDeletion = asyncHandler(async (req, res) => sendSuccess(res, { deletionRequest: (await authService.cancelAccountDeletionRequest(req.auth.userId)).toSafeJSON() }));
const exportData = asyncHandler(async (req, res) => sendSuccess(res, { export: await authService.exportAccountData(req.auth.userId) }));
const requestExport = asyncHandler(async (req, res) => res.status(202).json({ success: true, data: { exportJob: (await authService.requestAccountExport(req.auth.userId)).toSafeJSON() } }));
const getExport = asyncHandler(async (req, res) => sendSuccess(res, { exportJob: (await authService.getAccountExport(req.auth.userId, req.params.exportJobId)).toSafeJSON() }));
const deactivate = asyncHandler(async (req, res) => sendSuccess(res, { user: (await authService.deactivateAccount(req.auth.userId, req.body.reason)).toSafeJSON() }));
const sessions = asyncHandler(async (req, res) => sendSuccess(res, { sessions: await authService.listSessions(req.auth.userId, req.auth.sessionId) }));
const revokeSession = asyncHandler(async (req, res) => { await authService.revokeSession(req.auth.userId, req.params.sessionId); return res.status(204).send(); });
const revokeOtherSessions = asyncHandler(async (req, res) => sendSuccess(res, { revoked: await authService.revokeOtherSessions(req.auth.userId, req.auth.sessionId) }));

module.exports = { register, login, refresh, logout, me, updateProfile, updatePreferences, recordPrivacyConsent, getPrivacyConsent, accountLifecyclePolicy, getDeletionRequest, requestDeletion, cancelDeletion, exportData, requestExport, getExport, deactivate, sessions, revokeSession, revokeOtherSessions };
