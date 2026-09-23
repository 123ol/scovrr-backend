const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./staff.controller');
const { listMembersSchema, listInvitationsSchema, addMemberSchema, updateMemberSchema, invitationIdSchema } = require('./staff.validation');

const router = express.Router();
router.post('/staff-invitations/:token/accept', requireAuth, controller.acceptInvitation);
router.get('/:businessId/members', requireAuth, requireBusinessPermission('business.members.manage'), validate(listMembersSchema), controller.list);
router.get('/:businessId/invitations', requireAuth, requireBusinessPermission('business.members.manage'), validate(listInvitationsSchema), controller.invitations);
router.post('/:businessId/members', requireAuth, requireBusinessPermission('business.members.manage'), validate(addMemberSchema), controller.add);
router.patch('/:businessId/members/:membershipId', requireAuth, requireBusinessPermission('business.members.manage'), validate(updateMemberSchema), controller.update);
router.post('/:businessId/invitations/:invitationId/revoke', requireAuth, requireBusinessPermission('business.members.manage'), validate(invitationIdSchema), controller.revokeInvitation);

module.exports = router;
