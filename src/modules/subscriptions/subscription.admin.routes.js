const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./subscription.admin.controller');
const validation = require('./subscription.admin.validation');

const router = express.Router();
router.get('/plans', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_READ), controller.plans);
router.post('/plans', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_MANAGE), validate(validation.planCreateSchema), controller.createPlan);
router.post('/plans/:planId/versions', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_MANAGE), validate(validation.planVersionCreateSchema), controller.createVersion);
router.post('/plan-versions/:planVersionId/publish', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_MANAGE), validate(validation.planVersionIdSchema), controller.publishVersion);
router.post('/plan-versions/:planVersionId/retire', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_MANAGE), validate(validation.planVersionIdSchema), controller.retireVersion);
router.get('/business-subscriptions', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_READ), validate(validation.subscriptionListSchema), controller.subscriptions);
router.get('/businesses/:businessId/subscription', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_READ), validate(validation.businessIdSchema), controller.detail);
router.get('/businesses/:businessId/subscription/explain', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_READ), validate(validation.businessIdSchema), controller.explain);
router.post('/businesses/:businessId/subscription/overrides', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_MANAGE), validate(validation.overrideSchema), controller.addOverride);
router.post('/subscription-overrides/:overrideId/revoke', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.SUBSCRIPTIONS_MANAGE), validate(validation.overrideRevokeSchema), controller.revokeOverride);

module.exports = router;
