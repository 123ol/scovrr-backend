const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const itemBody = z.object({ productId: objectId, variantId: objectId.nullable().optional(), quantity: z.number().int().min(1).max(99) });
const addItemSchema = z.object({ body: itemBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const updateItemSchema = z.object({ body: itemBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const removeItemSchema = z.object({ body: z.object({ productId: objectId, variantId: objectId.nullable().optional() }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const couponSchema = z.object({ body: z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/) }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

module.exports = { addItemSchema, updateItemSchema, removeItemSchema, couponSchema };
