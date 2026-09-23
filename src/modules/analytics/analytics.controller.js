const { asyncHandler } = require('../../common/http/asyncHandler');
const service = require('./analytics.service');

const create = asyncHandler(async (req, res) => { const result = await service.recordClientEvent(req.auth?.userId, req.body); return res.status(202).json({ success: true, data: result }); });
const batch = asyncHandler(async (req, res) => { const results = await service.recordClientEvents(req.auth?.userId, req.body.events); return res.status(202).json({ success: true, data: { accepted: results.filter((item) => item.accepted).length, duplicates: results.filter((item) => item.duplicate).length } }); });

module.exports = { create, batch };
