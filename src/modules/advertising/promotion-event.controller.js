const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./promotion-event.service');

const impression = asyncHandler(async (req, res) => sendSuccess(res, await service.recordEvent(req, 'impression', req.body)));
const click = asyncHandler(async (req, res) => sendSuccess(res, await service.recordEvent(req, 'click', req.body)));

module.exports = { impression, click };
