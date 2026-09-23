const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./platform-analytics.controller');
const { schema } = require('./platform-analytics.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/overview', requireAdminPermission(ADMIN_PERMISSIONS.ANALYTICS_PLATFORM_READ || ADMIN_PERMISSIONS.ANALYTICS_READ), validate(schema), controller.overview);
router.get('/commerce', requireAdminPermission(ADMIN_PERMISSIONS.ANALYTICS_FINANCIAL_READ || ADMIN_PERMISSIONS.ANALYTICS_READ), validate(schema), controller.commerce);
router.get('/services', requireAdminPermission(ADMIN_PERMISSIONS.ANALYTICS_PLATFORM_READ || ADMIN_PERMISSIONS.ANALYTICS_READ), validate(schema), controller.services);
module.exports = router;
