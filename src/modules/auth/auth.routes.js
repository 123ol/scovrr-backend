const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate } = require('../../common/validation/validate');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./auth.controller');
const { registerSchema, loginSchema, refreshSchema, profileUpdateSchema } = require('./auth.validation');

const router = express.Router();
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const refreshLimiter = rateLimit({ windowMs: 15 * 60 * 1_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

router.post('/register', registerLimiter, validate(registerSchema), controller.register);
router.post('/login', loginLimiter, validate(loginSchema), controller.login);
router.post('/refresh', refreshLimiter, validate(refreshSchema), controller.refresh);
router.post('/logout', requireAuth, controller.logout);
router.get('/me', requireAuth, controller.me);
router.patch('/me', requireAuth, validate(profileUpdateSchema), controller.updateProfile);

module.exports = router;
