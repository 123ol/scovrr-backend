const express = require('express');
const { z } = require('zod');
const { validate } = require('../../common/validation/validate');
const { optionalAuth } = require('../../middleware/auth');
const controller = require('./product.controller');

const listSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessSlug: z.string().trim().min(1).max(120) }),
  query: z.object({ search: z.string().trim().max(100).optional(), categoryId: z.string().regex(/^[a-f\d]{24}$/i).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), sort: z.enum(['newest', 'price_low', 'price_high']).default('newest') })
});
const compareSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({ ids: z.string().trim().transform((value) => value.split(',').map((id) => id.trim())).pipe(z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(2).max(4)) })
});
const similarSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ slug: z.string().trim().min(1).max(180) }),
  query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) })
});

const router = express.Router();
router.get('/businesses/:businessSlug/products', validate(listSchema), controller.publicList);
router.get('/products/compare', validate(compareSchema), controller.compare);
router.get('/products/:slug/similar', validate(similarSchema), controller.similar);
router.get('/products/:slug', optionalAuth, controller.publicBySlug);

module.exports = router;
