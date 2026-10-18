const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./business.controller');
const { listAdminBusinessesSchema, listBusinessRiskSchema, rejectBusinessSchema, businessIdSchema, businessStatusSchema } = require('./business.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.BUSINESSES_READ), validate(listAdminBusinessesSchema), controller.adminList);
router.get('/risk', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.BUSINESSES_READ), validate(listBusinessRiskSchema), controller.adminRisk);
router.get('/:businessId/detail', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.BUSINESSES_READ), validate(businessIdSchema), controller.adminDetail);
router.post('/:businessId/approve', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.VERIFICATION_APPROVE), validate(businessIdSchema), controller.adminApprove);
router.post('/:businessId/reject', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.VERIFICATION_REJECT), validate(rejectBusinessSchema), controller.adminReject);
router.post('/:businessId/request-information', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.VERIFICATION_REJECT), validate(rejectBusinessSchema), controller.adminRequestInformation);
router.post('/:businessId/suspend', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.BUSINESSES_SUSPEND), validate(businessStatusSchema), controller.adminSuspend);
router.post('/:businessId/reactivate', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.BUSINESSES_RESTORE), validate(businessStatusSchema), controller.adminReactivate);

module.exports = router;
