const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./discovery.service');

const discover = asyncHandler(async (req, res) => sendSuccess(res, await service.discover(req.query)));

module.exports = { discover };
