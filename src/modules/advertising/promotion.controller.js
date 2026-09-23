const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./promotion.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listBusinessCampaigns(req.business._id, req.query)));
const get = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await service.getBusinessCampaign(req.business._id, req.params.campaignId)).toSafeJSON() }));
const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { campaign: (await service.createDraft(req.business._id, req.auth.userId, req.body)).toSafeJSON() } }));
const update = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await service.updateDraft(req.business._id, req.params.campaignId, req.auth.userId, req.body)).toSafeJSON() }));
const fund = asyncHandler(async (req, res) => { const result = await service.initializeFunding(req.business._id, req.auth.userId, req.params.campaignId, req.body); return sendSuccess(res, { campaign: result.campaign.toSafeJSON(), funding: result.funding.toSafeJSON(), payment: result.payment.toSafeJSON() }); });
const pause = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await service.transition(req.business._id, req.params.campaignId, req.auth.userId, 'PAUSED')).toSafeJSON() }));
const resume = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await service.transition(req.business._id, req.params.campaignId, req.auth.userId, 'ACTIVE')).toSafeJSON() }));
const cancel = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await service.transition(req.business._id, req.params.campaignId, req.auth.userId, 'CANCELLED')).toSafeJSON() }));
const metrics = asyncHandler(async (req, res) => sendSuccess(res, await service.getMetrics(req.business._id, req.params.campaignId, req.query)));

module.exports = { list, get, create, update, fund, pause, resume, cancel, metrics };
