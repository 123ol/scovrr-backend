const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./moderation.controller');
const { caseIdSchema, listSchema, assignSchema, decisionSchema, bulkDecisionSchema, noteSchema } = require('./moderation.validation');

const router = express.Router();
router.use('/appeals', require('./moderation-appeal.admin.routes'));
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_READ), validate(listSchema), controller.list);
router.get('/assignees', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_ASSIGN), controller.assignees);
router.post('/bulk-decision', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_RESOLVE), validate(bulkDecisionSchema), controller.bulkDecide);
router.get('/:caseId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_READ), validate(caseIdSchema), controller.get);
router.post('/:caseId/assign', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_ASSIGN), validate(assignSchema), controller.assign);
router.post('/:caseId/claim', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_ASSIGN), validate(caseIdSchema), controller.assign);
router.post('/:caseId/decision', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_RESOLVE), validate(decisionSchema), controller.decide);
router.post('/:caseId/notes', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.MODERATION_RESOLVE), validate(noteSchema), controller.note);

module.exports = router;
