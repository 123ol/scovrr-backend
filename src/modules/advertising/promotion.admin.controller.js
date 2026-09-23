const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./promotion.admin.service');
const promotionService = require('./promotion.service');
const paymentService = require('../payments/payment.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.list(req.query)));
const get = asyncHandler(async (req, res) => sendSuccess(res, await service.get(req.params.campaignId)));
const pause = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await promotionService.transitionAdmin(req.params.campaignId, req.auth.userId, 'PAUSED')).toSafeJSON() }));
const cancel = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await promotionService.transitionAdmin(req.params.campaignId, req.auth.userId, 'CANCELLED')).toSafeJSON() }));
const moderate = asyncHandler(async (req, res) => sendSuccess(res, { campaign: (await service.moderate(req.params.campaignId, req.auth.userId, req.body)).toSafeJSON() }));
const refund = asyncHandler(async (req, res) => sendSuccess(res, { refund: (await paymentService.requestRefund(req.auth.userId, req.body.paymentId, { amountMinor: req.body.amountMinor, reason: req.body.reason, idempotencyKey: req.body.idempotencyKey })).toSafeJSON() }));

module.exports = { list, get, pause, cancel, moderate, refund };
