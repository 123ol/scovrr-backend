const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./reconciliation.controller');
const { listSchema, runSchema, paymentSchema, resolveSchema } = require('./reconciliation.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.RECONCILIATION_READ), validate(listSchema), controller.list);
router.post('/run', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.RECONCILIATION_RUN), validate(runSchema), controller.run);
router.post('/payments/:paymentId/reconcile', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.RECONCILIATION_RUN), validate(paymentSchema), controller.reconcilePayment);
router.post('/:reconciliationId/resolve', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.RECONCILIATION_RESOLVE), validate(resolveSchema), controller.resolve);

module.exports = router;
