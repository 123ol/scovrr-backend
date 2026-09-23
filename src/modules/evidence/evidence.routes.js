const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./evidence.controller');
const { sessionSchema, completeSchema, accessSchema } = require('./evidence.validation');

const router = express.Router();
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, keyGenerator: (req) => req.auth?.userId || req.ip });
router.use(requireAuth);
router.post('/session', uploadLimiter, validate(sessionSchema), controller.createSession);
router.post('/session/:sessionId/complete', uploadLimiter, validate(completeSchema), controller.complete);
router.get('/:evidenceId/access', validate(accessSchema), controller.access);

module.exports = router;
