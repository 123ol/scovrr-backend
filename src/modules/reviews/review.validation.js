const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const media = z.object({ url: z.string().url().max(2_000), alt: z.string().trim().max(200).optional() });
const createReviewSchema = z.object({ body: z.object({ targetType: z.enum(['product', 'service']), targetId: objectId, orderId: objectId.optional(), bookingId: objectId.optional(), rating: z.number().int().min(1).max(5), text: z.string().trim().max(2_000).optional(), media: z.array(media).max(8).default([]) }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const listReviewSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ targetId: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) });
const businessListReviewSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) });
const responseSchema = z.object({ body: z.object({ text: z.string().trim().min(1).max(2_000) }), params: z.object({ businessId: objectId, reviewId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { createReviewSchema, listReviewSchema, businessListReviewSchema, responseSchema };
