const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./review.service');

const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { review: (await service.createReview(req.auth.userId, req.body)).toSafeJSON() } }));
const listProduct = asyncHandler(async (req, res) => sendSuccess(res, await service.listReviews('product', req.params.targetId, req.query)));
const listService = asyncHandler(async (req, res) => sendSuccess(res, await service.listReviews('service', req.params.targetId, req.query)));
const listBusiness = asyncHandler(async (req, res) => sendSuccess(res, await service.listBusinessReviews(req.params.businessId, req.query)));
const respond = asyncHandler(async (req, res) => sendSuccess(res, { review: (await service.respondToReview(req.params.businessId, req.auth.userId, req.params.reviewId, req.body.text)).toSafeJSON() }));

module.exports = { create, listProduct, listService, listBusiness, respond };
