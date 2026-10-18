const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const viewBody = z.object({ targetType: z.enum(['product', 'service']), targetId: objectId });
const viewSchema = z.object({ body: viewBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }) });

module.exports = { viewSchema, listSchema };
