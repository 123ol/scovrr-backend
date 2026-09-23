const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./catalogue-upload.controller');
const { sessionSchema, completeSchema } = require('./catalogue-upload.validation');

const router = express.Router();
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => req.auth?.userId || req.ip });
const mediaPermissions = ['products.create', 'services.create', 'content.create'];
router.post('/:businessId/uploads/catalogue/session', requireAuth, requireBusinessPermission(mediaPermissions), uploadLimiter, validate(sessionSchema), controller.createSession);
router.post('/:businessId/uploads/catalogue/session/:sessionId/complete', requireAuth, requireBusinessPermission(mediaPermissions), uploadLimiter, validate(completeSchema), controller.complete);

module.exports = router;
