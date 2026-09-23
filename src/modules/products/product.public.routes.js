const express = require('express');
const { z } = require('zod');
const { validate } = require('../../common/validation/validate');
const controller = require('./product.controller');

const listSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessSlug: z.string().trim().min(1).max(120) }),
  query: z.object({ search: z.string().trim().max(100).optional(), categoryId: z.string().regex(/^[a-f\d]{24}$/i).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), sort: z.enum(['newest', 'price_low', 'price_high']).default('newest') })
});

const router = express.Router();
router.get('/businesses/:businessSlug/products', validate(listSchema), controller.publicList);
router.get('/products/:slug', controller.publicBySlug);

module.exports = router;
