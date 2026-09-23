const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const media = z.object({ url: z.string().url().max(2_000), provider: z.string().trim().max(80).optional(), publicId: z.string().trim().max(300).optional(), alt: z.string().trim().max(200).optional(), order: z.number().int().min(0).max(100).default(0) });
const portfolioBody = z.object({ serviceId: objectId.optional(), title: z.string().trim().min(2).max(160), description: z.string().trim().max(1_000).optional(), media: z.array(media).min(1).max(20), tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]), status: z.enum(['draft', 'published', 'archived']).default('draft'), sortOrder: z.number().int().min(0).max(10_000).default(0) });
const createPortfolioSchema = z.object({ body: portfolioBody, params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const updatePortfolioSchema = z.object({ body: portfolioBody.partial(), params: z.object({ businessId: objectId, portfolioId: objectId }), query: z.record(z.never()).default({}) });
const portfolioListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ status: z.enum(['draft', 'published', 'archived']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const publicPortfolioSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessSlug: z.string().trim().min(1).max(120) }), query: z.record(z.never()).default({}) });

module.exports = { createPortfolioSchema, updatePortfolioSchema, portfolioListSchema, publicPortfolioSchema };
