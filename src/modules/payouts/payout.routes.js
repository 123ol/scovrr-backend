const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./payout.controller');
const { listSchema, adminListSchema, payoutActionSchema, payoutProfileSchema, payoutProfileReadSchema, earningsSchema, statementSchema } = require('./payout.validation');

const businessRouter = express.Router();
businessRouter.get('/:businessId/payouts', requireAuth, requireBusinessPermission('finance.view'), validate(listSchema), controller.listBusiness);
businessRouter.get('/:businessId/payout-profile', requireAuth, requireBusinessPermission('finance.view'), validate(payoutProfileReadSchema), controller.getProfile);
businessRouter.get('/:businessId/earnings', requireAuth, requireBusinessPermission('finance.view'), validate(earningsSchema), controller.earnings);
businessRouter.get('/:businessId/earnings/statement', requireAuth, requireBusinessPermission('finance.view'), validate(statementSchema), controller.statement);

const adminRouter = express.Router();
adminRouter.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_READ), validate(adminListSchema), controller.listAdmin);
adminRouter.post('/:payoutId/execute', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_EXECUTE), validate(payoutActionSchema), controller.execute);
adminRouter.post('/:payoutId/retry', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_EXECUTE), validate(payoutActionSchema), controller.retry);
adminRouter.post('/:payoutId/verify', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_EXECUTE), validate(payoutActionSchema), controller.verify);
adminRouter.post('/:payoutId/hold', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_HOLD), validate(payoutActionSchema), controller.hold);
adminRouter.post('/:payoutId/release', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_RELEASE), validate(payoutActionSchema), controller.release);
adminRouter.patch('/businesses/:businessId/profile', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_MANAGE), validate(payoutProfileSchema), controller.setProfile);

module.exports = { businessRouter, adminRouter };
