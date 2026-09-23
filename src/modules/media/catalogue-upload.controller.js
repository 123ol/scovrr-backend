const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./catalogue-upload.service');

const createSession = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: await service.createSession({ userId: req.auth.userId, businessId: req.business._id, mimeType: req.body.mimeType }) }));
const complete = asyncHandler(async (req, res) => sendSuccess(res, { media: await service.completeSession({ userId: req.auth.userId, businessId: req.business._id, sessionId: req.params.sessionId, publicId: req.body.publicId, alt: req.body.alt }) }));

module.exports = { createSession, complete };
