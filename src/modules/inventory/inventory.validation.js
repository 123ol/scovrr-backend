const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const listPositionsSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ locationId: objectId.optional(), productId: objectId.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }) });
const forecastSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ locationId: objectId.optional(), productId: objectId.optional(), days: z.coerce.number().int().min(7).max(90).default(30) }) });
const forecastExportSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ locationId: objectId.optional(), productId: objectId.optional(), days: z.coerce.number().int().min(7).max(90).default(30) }) });
const transferSchema = z.object({ body: z.object({ sourceLocationId: objectId, destinationLocationId: objectId, productId: objectId, variantId: objectId.optional(), quantity: z.number().int().positive().max(1_000_000), reason: z.string().trim().min(3).max(500) }), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { listPositionsSchema, forecastSchema, forecastExportSchema, transferSchema };
