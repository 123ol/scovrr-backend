const express = require('express');
const { validate } = require('../../common/validation/validate');
const { optionalAuth } = require('../../middleware/auth');
const { z } = require('zod');
const controller = require('./recommendation.controller');
const { discoverSchema } = require('../discovery/discovery.validation');

const router = express.Router();
const recommendationSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ limit: z.coerce.number().int().min(1).max(24).default(12) }) });
const togetherSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i), limit: z.coerce.number().int().min(1).max(12).default(6) }) });
router.get('/home', optionalAuth, validate(discoverSchema), controller.home);
router.get('/personalized', optionalAuth, validate(recommendationSchema), controller.personalized);
router.get('/frequently-bought-together', validate(togetherSchema), controller.frequentlyBoughtTogether);

module.exports = router;
