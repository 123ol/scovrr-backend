const { asyncHandler } = require('../../common/http/asyncHandler');
const service = require('./platform-analytics.service');
const wrap = (method, key) => asyncHandler(async (req, res) => res.json({ success: true, data: { [key]: await service[method](req.query) } }));
module.exports = { overview: wrap('getOverview', 'analytics'), commerce: wrap('getCommerceReport', 'commerce'), services: wrap('getServicesReport', 'services') };
