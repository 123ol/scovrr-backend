const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./audit.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listAuditLogs(req.query)));

module.exports = { list };
