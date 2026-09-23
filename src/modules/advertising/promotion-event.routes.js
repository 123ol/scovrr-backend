const express = require('express');
const rateLimit = require('express-rate-limit');
const { optionalAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const { eventSchema } = require('./promotion.validation');
const controller = require('./promotion-event.controller');

const router = express.Router();
const eventRateLimit = rateLimit({ windowMs: 15 * 60 * 1_000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false });
router.post('/impression', eventRateLimit, optionalAuth, validate(eventSchema), controller.impression);
router.post('/click', eventRateLimit, optionalAuth, validate(eventSchema), controller.click);

module.exports = router;
