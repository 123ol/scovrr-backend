const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const favoriteBody = z.object({ targetType: z.enum(['product', 'service', 'business']), targetId: objectId });
const favoriteSchema = z.object({ body: favoriteBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const removeFavoriteSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ targetType: z.enum(['product', 'service', 'business']), targetId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { favoriteSchema, removeFavoriteSchema };
