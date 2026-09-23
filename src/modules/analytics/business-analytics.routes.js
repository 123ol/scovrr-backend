const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./business-analytics.controller');
const { schema } = require('./business-analytics.validation');

const router = express.Router();
router.use(requireAuth);
for (const [path, handler] of [['overview', controller.overview], ['sales', controller.sales], ['products', controller.products], ['services', controller.services], ['locations', controller.locations], ['customers', controller.customers]]) router.get(`/:businessId/analytics/${path}`, requireBusinessPermission('analytics.read'), validate(schema), handler);
module.exports = router;
