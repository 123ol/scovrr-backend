const express = require('express');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./evidence.controller');
const { accessSchema, policySchema } = require('./evidence.validation');

const router = express.Router();
router.get('/policy', requireAuth, requireAdmin, validate(policySchema), controller.policy);
router.get('/:evidenceId/access', requireAuth, requireAdmin, validate(accessSchema), controller.adminAccess);

module.exports = router;
