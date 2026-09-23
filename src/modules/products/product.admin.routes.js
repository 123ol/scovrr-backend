const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth, requireAdminPermission, requireAllAdminPermissions } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./product.controller');
const { adminProductListSchema, rejectProductSchema, productReviewIdSchema } = require('./product.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PRODUCTS_READ), validate(adminProductListSchema), controller.adminList);
router.post('/:productId/approve', requireAuth, requireAllAdminPermissions([ADMIN_PERMISSIONS.PRODUCTS_MODERATE, ADMIN_PERMISSIONS.MODERATION_RESOLVE]), validate(productReviewIdSchema), controller.adminApprove);
router.post('/:productId/reject', requireAuth, requireAllAdminPermissions([ADMIN_PERMISSIONS.PRODUCTS_MODERATE, ADMIN_PERMISSIONS.MODERATION_RESOLVE]), validate(rejectProductSchema), controller.adminReject);

module.exports = router;
