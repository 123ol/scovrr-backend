const express = require('express');
const { requireAuth, requireAdmin } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./evidence.controller');
const { accessSchema } = require('./evidence.validation');

const router = express.Router();
router.get('/:evidenceId/access', requireAuth, requireAdmin, validate(accessSchema), controller.adminAccess);

module.exports = router;
