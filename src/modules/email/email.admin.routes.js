const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./email.controller');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { adminListSchema, retrySchema, announcementSchema } = require('./email.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', requireAdminPermission(ADMIN_PERMISSIONS.EMAILS_READ), validate(adminListSchema), controller.list);
router.post('/:deliveryId/retry', requireAdminPermission(ADMIN_PERMISSIONS.EMAILS_RETRY), validate(retrySchema), controller.retry);
router.post('/announcements', requireAdminPermission(ADMIN_PERMISSIONS.EMAILS_SEND), validate(announcementSchema), controller.announcement);

module.exports = router;
