const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const statuses = z.enum(['pending', 'eligible', 'queued', 'processing', 'paid', 'failed', 'held', 'reversed']);
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ status: statuses.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const adminListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: statuses.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const payoutIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ payoutId: objectId }), query: z.record(z.never()).default({}) });
const payoutActionSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(2_000) }), params: z.object({ payoutId: objectId }), query: z.record(z.never()).default({}) });
const payoutProfileSchema = z.object({ body: z.object({ provider: z.enum(['paystack']).default('paystack'), recipientCode: z.string().trim().min(5).max(200), currency: z.string().trim().toUpperCase().length(3).default('NGN'), status: z.enum(['pending', 'active', 'disabled']).default('pending') }), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const payoutProfileReadSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const earningsSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ range: z.enum(['today', '7d', '30d', 'custom']).default('30d'), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional() }) });
const statementSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ range: z.enum(['today', '7d', '30d', 'custom']).default('30d'), from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), format: z.enum(['json', 'csv']).default('json') }) });

module.exports = { listSchema, adminListSchema, payoutIdSchema, payoutActionSchema, payoutProfileSchema, payoutProfileReadSchema, earningsSchema, statementSchema };
