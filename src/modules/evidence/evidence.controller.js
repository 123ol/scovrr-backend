const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./evidence.service');

const createSession = asyncHandler(async (req, res) => {
  const result = await service.createUploadSession(req.auth.userId, req.body);
  return res.status(201).json({ success: true, data: { session: { id: result.session._id.toString(), purpose: result.session.purpose, status: result.session.status, expiresAt: result.session.expiresAt, maxBytes: result.session.maxBytes }, upload: result.upload, type: result.type } });
});

const complete = asyncHandler(async (req, res) => sendSuccess(res, { evidence: (await service.completeUploadSession(req.auth.userId, req.params.sessionId, req.body)).toSafeJSON() }));

const access = asyncHandler(async (req, res) => { const result = await service.getAccessUrl(req.auth.userId, req.params.evidenceId); return sendSuccess(res, { evidence: result.asset.toSafeJSON(), url: result.url, expiresAt: result.expiresAt }); });
const adminAccess = asyncHandler(async (req, res) => { const result = await service.getAccessUrl(req.auth.userId, req.params.evidenceId, { admin: true, permissions: req.admin?.permissions || [] }); return sendSuccess(res, { evidence: result.asset.toSafeJSON(), url: result.url, expiresAt: result.expiresAt }); });
const policy = asyncHandler(async (req, res) => sendSuccess(res, { policy: service.getEvidenceRetentionPolicy() }));

module.exports = { createSession, complete, access, adminAccess, policy };
