const { asyncHandler } = require('../../common/http/asyncHandler');
const service = require('./business-analytics.service');
const wrap = (method, key) => asyncHandler(async (req, res) => res.json({ success: true, data: { [key]: await service[method](req.business._id, req.businessMembership, req.query) } }));
module.exports = { overview: wrap('getOverview', 'analytics'), sales: wrap('getSales', 'sales'), products: wrap('getProducts', 'products'), services: wrap('getServices', 'services'), locations: wrap('getLocations', 'locations'), customers: wrap('getCustomers', 'customers') };
