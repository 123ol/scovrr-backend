const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./recommendation.service');

const home = asyncHandler(async (req, res) => sendSuccess(res, await service.getPersonalizedRecommendations(req.query, req.auth?.userId)));
const personalized = asyncHandler(async (req, res) => sendSuccess(res, await service.getPersonalizedRecommendations(req.query, req.auth?.userId)));
const frequentlyBoughtTogether = asyncHandler(async (req, res) => sendSuccess(res, { products: await service.frequentlyBoughtTogether(req.query.productId, req.query.limit) }));

module.exports = { home, personalized, frequentlyBoughtTogether };
