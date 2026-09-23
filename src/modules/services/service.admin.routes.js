const express = require('express');
const { requireAuth, requireAdminPermission, requireAllAdminPermissions } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./service.controller');
const { adminServiceListSchema, rejectServiceSchema, serviceReviewIdSchema } = require('./service.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SERVICES_READ), validate(adminServiceListSchema), controller.adminList);
router.post('/:serviceId/approve', requireAuth, requireAllAdminPermissions([ADMIN_PERMISSIONS.SERVICES_MODERATE, ADMIN_PERMISSIONS.MODERATION_RESOLVE]), validate(serviceReviewIdSchema), controller.adminApprove);
router.post('/:serviceId/reject', requireAuth, requireAllAdminPermissions([ADMIN_PERMISSIONS.SERVICES_MODERATE, ADMIN_PERMISSIONS.MODERATION_RESOLVE]), validate(rejectServiceSchema), controller.adminReject);

module.exports = router;
