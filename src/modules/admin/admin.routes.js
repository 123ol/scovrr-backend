const express = require('express');
const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const { validate } = require('../../common/validation/validate');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('./admin-permissions');
const categoryAdminRoutes = require('../categories/category.admin.routes');
const businessAdminRoutes = require('../businesses/business.admin.routes');
const productAdminRoutes = require('../products/product.admin.routes');
const serviceAdminRoutes = require('../services/service.admin.routes');
const contentPostAdminRoutes = require('../content-posts/content-post.admin.routes');
const auditRoutes = require('../audit/audit.routes');
const reportAdminRoutes = require('../reports/report.admin.routes');
const disputeAdminRoutes = require('../disputes/dispute.admin.routes');
const moderationAdminRoutes = require('../moderation/moderation.admin.routes');
const evidenceAdminRoutes = require('../evidence/evidence.admin.routes');
const promotionAdminRoutes = require('../promotions/promotion.admin.routes');
const subscriptionAdminRoutes = require('../subscriptions/subscription.admin.routes');
const { permissionsForAdminRoles } = require('./admin-rbac');
const controller = require('./admin.controller');
const { adminListSchema, userListSchema, inviteAdminSchema, updateRolesSchema, adminStatusSchema, userStatusSchema, acceptInvitationSchema } = require('./admin.validation');

const router = express.Router();

router.post('/invitations/:token/accept', validate(acceptInvitationSchema), controller.acceptInvitation);

router.get('/session', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMIN_ACCESS), asyncHandler(async (req, res) => {
  return sendSuccess(res, {
    user: req.auth.user.toSafeJSON({ includeAdmin: true }),
    permissions: permissionsForAdminRoles(req.auth.user.adminRoles),
    roles: req.auth.user.adminRoles
  });
}));
router.get('/me', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMIN_ACCESS), controller.me);
router.get('/roles', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMIN_ROLES_READ), controller.roles);
router.get('/admins', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMINS_READ), validate(adminListSchema), controller.list);
router.get('/users', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_READ), validate(userListSchema), controller.listUsers);
router.post('/admins/invitations', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMINS_CREATE), validate(inviteAdminSchema), controller.invite);
router.patch('/admins/:adminId/roles', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMINS_UPDATE), validate(updateRolesSchema), controller.updateRoles);
router.post('/admins/:adminId/suspend', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMINS_SUSPEND), validate(adminStatusSchema), controller.suspend);
router.post('/admins/:adminId/reactivate', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.ADMINS_SUSPEND), validate(adminStatusSchema), controller.reactivate);
router.post('/users/:userId/suspend', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_SUSPEND), validate(userStatusSchema), controller.suspendUser);
router.post('/users/:userId/reactivate', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_RESTORE), validate(userStatusSchema), controller.reactivateUser);

router.use('/categories', categoryAdminRoutes);
router.use('/businesses', businessAdminRoutes);
router.use('/products', productAdminRoutes);
router.use('/services', serviceAdminRoutes);
router.use('/content-posts', contentPostAdminRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/reports', reportAdminRoutes);
router.use('/disputes', disputeAdminRoutes);
router.use('/moderation', moderationAdminRoutes);
router.use('/evidence', evidenceAdminRoutes);
router.use('/discounts', promotionAdminRoutes);
router.use('/subscriptions', subscriptionAdminRoutes);

module.exports = router;
