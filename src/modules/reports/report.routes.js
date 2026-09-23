const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./report.controller');
const { createReportSchema, reportIdSchema, reporterListSchema, attachEvidenceSchema } = require('./report.validation');

const router = express.Router();
const reportCreationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => req.auth?.userId || req.ip });
router.use(requireAuth);
router.post('/', reportCreationLimiter, validate(createReportSchema), controller.create);
router.post('/:reportId/evidence', reportCreationLimiter, validate(attachEvidenceSchema), controller.addEvidence);
router.get('/', validate(reporterListSchema), controller.mine);
router.get('/:reportId', validate(reportIdSchema), controller.getMine);

module.exports = router;
