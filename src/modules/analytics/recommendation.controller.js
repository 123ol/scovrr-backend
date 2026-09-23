const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./recommendation.service');

const home = asyncHandler(async (req, res) => sendSuccess(res, await service.getHomeRecommendations(req.query)));

module.exports = { home };
