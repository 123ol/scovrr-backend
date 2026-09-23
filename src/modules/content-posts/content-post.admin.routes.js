const express = require('express');
const { requireAuth, requireAdminPermission, requireAllAdminPermissions } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./content-post.controller');
const { adminListSchema, adminPostIdSchema, rejectSchema } = require('./content-post.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.CONTENT_READ), validate(adminListSchema), controller.adminList);
router.post('/:postId/approve', requireAuth, requireAllAdminPermissions([ADMIN_PERMISSIONS.CONTENT_MODERATE, ADMIN_PERMISSIONS.MODERATION_RESOLVE]), validate(adminPostIdSchema), controller.adminApprove);
router.post('/:postId/reject', requireAuth, requireAllAdminPermissions([ADMIN_PERMISSIONS.CONTENT_MODERATE, ADMIN_PERMISSIONS.MODERATION_RESOLVE]), validate(rejectSchema), controller.adminReject);

module.exports = router;
