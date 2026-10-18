const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./platform-commission.controller');
const { getPlatformCommissionSchema, updatePlatformCommissionSchema } = require('./platform-commission.validation');

const router = express.Router();
router.get('/commission', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SETTINGS_READ), validate(getPlatformCommissionSchema), controller.get);
router.patch('/commission', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SETTINGS_MANAGE), validate(updatePlatformCommissionSchema), controller.update);

module.exports = router;
