const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./business-analytics.controller');
const { schema, profileReadSchema, profileWriteSchema, customerDirectoryExportSchema } = require('./business-analytics.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/:businessId/analytics/customer-directory/:customerId/profile', requireBusinessPermission('customers.read'), validate(profileReadSchema), controller.customerProfile);
router.put('/:businessId/analytics/customer-directory/:customerId/profile', requireBusinessPermission('customers.manage'), validate(profileWriteSchema), controller.updateCustomerProfile);
router.get('/:businessId/analytics/customer-directory/export', requireBusinessPermission('customers.read'), validate(customerDirectoryExportSchema), controller.customerDirectoryExport);
for (const [path, handler] of [['overview', controller.overview], ['sales', controller.sales], ['products', controller.products], ['services', controller.services], ['locations', controller.locations], ['customers', controller.customers], ['customer-segments', controller.customerSegments], ['customer-directory', controller.customerDirectory], ['staff-productivity', controller.staffProductivity], ['response-time', controller.responseTime]]) router.get(`/:businessId/analytics/${path}`, requireBusinessPermission('analytics.read'), validate(schema), handler);
module.exports = router;
