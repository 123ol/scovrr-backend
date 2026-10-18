const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./moderation.service');
const { recordAudit } = require('../audit/audit.service');

const businessEligible = asyncHandler(async (req, res) => sendSuccess(res, { cases: await service.listBusinessAppealableCases(req.business._id) }));
const businessList = asyncHandler(async (req, res) => sendSuccess(res, await service.listBusinessAppeals(req.business._id, req.query)));
const businessGet = asyncHandler(async (req, res) => sendSuccess(res, { appeal: (await service.getBusinessAppeal(req.business._id, req.params.appealId)).toSafeJSON() }));
const businessCreate = asyncHandler(async (req, res) => {
  const appeal = await service.createAppeal(req.auth.userId, req.body.moderationCaseId, req.body.reason);
  await recordAudit({ actorType: 'user', actorId: req.auth.userId, action: 'MODERATION_APPEAL_CREATED', targetType: 'moderation_appeal', targetId: appeal._id, businessId: req.business._id, reason: 'Business appealed a moderation decision', metadata: { moderationCaseId: req.body.moderationCaseId }, ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return res.status(201).json({ success: true, data: { appeal: appeal.toSafeJSON() } });
});

const adminList = asyncHandler(async (req, res) => sendSuccess(res, await service.listAdminAppeals(req.query)));
const adminGet = asyncHandler(async (req, res) => sendSuccess(res, { appeal: (await service.getAdminAppeal(req.params.appealId)).toSafeJSON() }));
const adminDecide = asyncHandler(async (req, res) => {
  const appeal = await service.decideAppeal(req.params.appealId, req.auth.userId, req.body.outcome, req.body.note);
  await recordAudit({ actorId: req.auth.userId, action: 'MODERATION_APPEAL_DECIDED', targetType: 'moderation_appeal', targetId: appeal._id, reason: req.body.note, after: appeal.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { appeal: appeal.toSafeJSON() });
});

module.exports = { businessEligible, businessList, businessGet, businessCreate, adminList, adminGet, adminDecide };
