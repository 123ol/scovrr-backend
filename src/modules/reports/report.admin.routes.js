const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./report.controller');
const { adminReportListSchema, reportIdSchema, investigationSchema, assignReportSchema, prioritySchema, reviewReportSchema, escalateReportSchema, resolveReportSchema, noteSchema } = require('./report.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_READ), validate(adminReportListSchema), controller.adminList);
router.get('/:reportId/investigation', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_READ), validate(investigationSchema), controller.adminInvestigation);
router.get('/:reportId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_READ), validate(reportIdSchema), controller.adminGet);
router.post('/:reportId/assign', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_ASSIGN), validate(assignReportSchema), controller.assign);
router.post('/:reportId/claim', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_ASSIGN), validate(reportIdSchema), controller.assign);
router.post('/:reportId/priority', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_ASSIGN), validate(prioritySchema), controller.priority);
router.post('/:reportId/review', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_ASSIGN), validate(reviewReportSchema), controller.review);
router.post('/:reportId/escalate', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_ASSIGN), validate(escalateReportSchema), controller.escalate);
router.post('/:reportId/resolve', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_RESOLVE), validate(resolveReportSchema), controller.resolve);
router.post('/:reportId/notes', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.REPORTS_RESOLVE), validate(noteSchema), controller.note);

module.exports = router;
