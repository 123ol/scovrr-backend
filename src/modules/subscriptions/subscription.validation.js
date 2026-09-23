const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const businessSubscriptionSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const invoiceListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const cancelSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(1_000).default('Cancelled by business owner') }), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const changeSchema = z.object({ body: z.object({ planVersionId: objectId.optional(), planCode: z.string().trim().min(2).max(50).optional(), billingInterval: z.enum(['monthly', 'yearly']).default('monthly') }).refine((value) => value.planVersionId || value.planCode, 'A plan or plan version is required'), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const checkoutSchema = z.object({ body: z.object({ planVersionId: objectId.optional(), planCode: z.string().trim().min(2).max(50).optional(), billingInterval: z.enum(['monthly', 'yearly']).default('monthly'), idempotencyKey: z.string().trim().min(8).max(160).optional() }).refine((value) => value.planVersionId || value.planCode, 'A plan or plan version is required'), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { businessSubscriptionSchema, invoiceListSchema, cancelSchema, changeSchema, checkoutSchema };
