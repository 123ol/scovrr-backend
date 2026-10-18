const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./recently-viewed.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, { views: await service.listViews(req.auth.userId, req.query.limit) }));
const record = asyncHandler(async (req, res) => sendSuccess(res, { view: await service.recordView(req.auth.userId, req.body) }));

module.exports = { list, record };
