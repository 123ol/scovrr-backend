const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate } = require('../../common/validation/validate');
const { requireAuth } = require('../../middleware/auth');
const controller = require('./auth.controller');
const { registerSchema, loginSchema, refreshSchema, profileUpdateSchema, preferenceUpdateSchema, privacyConsentSchema, privacyConsentReadSchema, deactivateSchema, sessionIdSchema, sessionsSchema, exportJobIdSchema, deletionRequestSchema, lifecyclePolicySchema } = require('./auth.validation');

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
router.patch('/me/preferences', requireAuth, validate(preferenceUpdateSchema), controller.updatePreferences);
router.post('/me/privacy-consent', requireAuth, validate(privacyConsentSchema), controller.recordPrivacyConsent);
router.get('/me/privacy-consent', requireAuth, validate(privacyConsentReadSchema), controller.getPrivacyConsent);
router.get('/me/account-lifecycle-policy', requireAuth, validate(lifecyclePolicySchema), controller.accountLifecyclePolicy);
router.get('/me/deletion-request', requireAuth, validate(lifecyclePolicySchema), controller.getDeletionRequest);
router.post('/me/deletion-request', requireAuth, validate(deletionRequestSchema), controller.requestDeletion);
router.delete('/me/deletion-request', requireAuth, validate(lifecyclePolicySchema), controller.cancelDeletion);
router.post('/me/export/request', requireAuth, controller.requestExport);
router.get('/me/export/:exportJobId', requireAuth, validate(exportJobIdSchema), controller.getExport);
router.get('/me/export', requireAuth, controller.exportData);
router.post('/me/deactivate', requireAuth, validate(deactivateSchema), controller.deactivate);
router.get('/sessions', requireAuth, validate(sessionsSchema), controller.sessions);
router.delete('/sessions/others', requireAuth, validate(sessionsSchema), controller.revokeOtherSessions);
router.delete('/sessions/:sessionId', requireAuth, validate(sessionIdSchema), controller.revokeSession);

module.exports = router;
