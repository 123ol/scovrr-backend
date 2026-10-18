const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./audit.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listAuditLogs(req.query)));
const summary = asyncHandler(async (req, res) => sendSuccess(res, { summary: await service.getAuditSummary(req.query) }));

module.exports = { list, summary };
