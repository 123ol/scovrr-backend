const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const authService = require('./auth.service');

function requestMetadata(req) {
  return {
    userAgent: req.get('user-agent'),
    ipAddress: req.ip
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

module.exports = { register, login, refresh, logout, me, updateProfile };
