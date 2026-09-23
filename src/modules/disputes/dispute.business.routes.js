const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./dispute.controller');
const { businessDisputeListSchema, disputeIdSchema, respondDisputeSchema } = require('./dispute.validation');

const router = express.Router();
const disputeBusinessPermissions = ['customers.manage', 'orders.manage', 'bookings.manage'];
router.get('/:businessId/disputes', requireAuth, requireBusinessPermission(disputeBusinessPermissions), validate(businessDisputeListSchema), controller.listBusiness);
router.get('/:businessId/disputes/:disputeId', requireAuth, requireBusinessPermission(disputeBusinessPermissions), validate(disputeIdSchema), controller.getBusiness);
router.post('/:businessId/disputes/:disputeId/respond', requireAuth, requireBusinessPermission(disputeBusinessPermissions), validate(respondDisputeSchema), controller.respondBusiness);

module.exports = router;
