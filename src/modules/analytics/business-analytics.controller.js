const { asyncHandler } = require('../../common/http/asyncHandler');
const service = require('./business-analytics.service');
const wrap = (method, key) => asyncHandler(async (req, res) => res.json({ success: true, data: { [key]: await service[method](req.business._id, req.businessMembership, req.query) } }));
const customerProfile = asyncHandler(async (req, res) => res.json({ success: true, data: { customerProfile: await service.getCustomerProfile(req.business._id, req.businessMembership, req.params.customerId, req.query) } }));
const updateCustomerProfile = asyncHandler(async (req, res) => res.json({ success: true, data: { customerProfile: await service.updateCustomerProfile(req.business._id, req.businessMembership, req.params.customerId, req.auth.userId, req.body, req.query) } }));
const customerDirectoryExport = asyncHandler(async (req, res) => {
  const directory = await service.getCustomerDirectory(req.business._id, req.businessMembership, req.query);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="scovrr-customer-directory.csv"');
  return res.send(service.customerDirectoryCsv(directory.customers));
});
module.exports = { overview: wrap('getOverview', 'analytics'), sales: wrap('getSales', 'sales'), products: wrap('getProducts', 'products'), services: wrap('getServices', 'services'), locations: wrap('getLocations', 'locations'), customers: wrap('getCustomers', 'customers'), customerSegments: wrap('getCustomerSegments', 'customerSegments'), customerDirectory: wrap('getCustomerDirectory', 'customerDirectory'), customerDirectoryExport, customerProfile, updateCustomerProfile, staffProductivity: wrap('getStaffProductivity', 'staffProductivity'), responseTime: wrap('getResponseTime', 'responseTime') };
