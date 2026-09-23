const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./payment.controller');
const { refundSchema, adminPaymentListSchema } = require('./payment.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYMENTS_READ), validate(adminPaymentListSchema), controller.adminList);
router.post('/:paymentId/refund', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REFUNDS_EXECUTE), validate(refundSchema), controller.refund);

module.exports = router;
