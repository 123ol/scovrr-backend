const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const businessIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const userIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ userId: objectId }), query: z.record(z.never()).default({}) });
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });

module.exports = { businessIdSchema, userIdSchema, listSchema };
