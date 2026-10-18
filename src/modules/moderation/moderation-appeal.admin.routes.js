const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./moderation-appeal.controller');
const validation = require('./moderation-appeal.validation');

const router = express.Router();

router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_READ), validate(validation.adminListSchema), controller.adminList);
router.get('/:appealId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_READ), validate(validation.appealIdSchema), controller.adminGet);
router.post('/:appealId/decision', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_RESOLVE), validate(validation.decisionSchema), controller.adminDecide);

module.exports = router;
