const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('../admin/admin.controller');
const { deletionRequestIdSchema, deletionRequestReviewSchema, deletionRequestListSchema, lifecyclePolicySchema } = require('./auth.validation');

const router = express.Router();

router.get('/policy', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_DELETION_READ), validate(lifecyclePolicySchema), controller.accountLifecyclePolicy);
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_DELETION_READ), validate(deletionRequestListSchema), controller.listAccountDeletionRequests);
router.post('/:requestId/review', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_DELETION_REVIEW), validate(deletionRequestReviewSchema), controller.reviewAccountDeletionRequest);
router.get('/:requestId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.USERS_DELETION_READ), validate(deletionRequestIdSchema), controller.getAccountDeletionRequest);

module.exports = router;
