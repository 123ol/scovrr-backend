const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const subjectType = z.enum(['business', 'product', 'service', 'content_post', 'review']);
const status = z.enum(['pending', 'under_review', 'approved', 'rejected', 'withdrawn']);

const businessListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ status: status.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const businessIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const createSchema = z.object({ body: z.object({ moderationCaseId: objectId, reason: z.string().trim().min(10).max(4_000) }), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const appealIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ appealId: objectId }), query: z.record(z.never()).default({}) });
const adminListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: status.optional(), subjectType: subjectType.optional(), businessId: objectId.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const decisionSchema = z.object({ body: z.object({ outcome: z.enum(['approved', 'rejected']), note: z.string().trim().min(5).max(4_000) }), params: z.object({ appealId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { businessListSchema, businessIdSchema, createSchema, appealIdSchema, adminListSchema, decisionSchema };
