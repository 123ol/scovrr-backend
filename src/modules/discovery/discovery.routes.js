const express = require('express');
const { optionalAuth, requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./discovery.controller');
const { discoverSchema, nearbySchema } = require('./discovery.validation');
const { z } = require('zod');

const suggestionSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ q: z.string().trim().max(120).optional() }) });
const historyListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) });
const historyCreateSchema = z.object({ body: z.object({ query: z.string().trim().min(2).max(120) }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const historyIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ historyId: z.string().regex(/^[a-f\d]{24}$/i) }), query: z.record(z.never()).default({}) });

const router = express.Router();

router.get('/suggestions', optionalAuth, validate(suggestionSchema), controller.suggestions);
router.get('/nearby', validate(nearbySchema), controller.nearby);
router.get('/history', requireAuth, validate(historyListSchema), controller.history);
router.post('/history', requireAuth, validate(historyCreateSchema), controller.recordHistory);
router.delete('/history/:historyId', requireAuth, validate(historyIdSchema), controller.removeHistory);
router.get('/', optionalAuth, validate(discoverSchema), controller.discover);

module.exports = router;
