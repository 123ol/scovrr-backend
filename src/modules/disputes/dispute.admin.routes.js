const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./dispute.controller');
const { disputeListSchema, disputeIdSchema, assignDisputeSchema, reviewDisputeSchema, resolveDisputeSchema, noteSchema, policySchema } = require('./dispute.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_READ), validate(disputeListSchema), controller.adminList);
router.get('/policy', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_READ), validate(policySchema), controller.policy);
router.get('/:disputeId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_READ), validate(disputeIdSchema), controller.adminGet);
router.post('/:disputeId/assign', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_ASSIGN), validate(assignDisputeSchema), controller.adminAssign);
router.post('/:disputeId/claim', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_ASSIGN), validate(disputeIdSchema), controller.adminAssign);
router.post('/:disputeId/review', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_ASSIGN), validate(reviewDisputeSchema), controller.adminReview);
router.post('/:disputeId/resolve', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_RESOLVE), validate(resolveDisputeSchema), controller.adminResolve);
router.post('/:disputeId/notes', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISPUTES_RESOLVE), validate(noteSchema), controller.adminNote);

module.exports = router;
