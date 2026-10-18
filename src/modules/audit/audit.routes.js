const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./audit.controller');
const { auditListSchema, auditSummarySchema } = require('./audit.validation');

const router = express.Router();
router.get('/summary', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.AUDIT_READ), validate(auditSummarySchema), controller.summary);
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.AUDIT_READ), validate(auditListSchema), controller.list);

module.exports = router;
