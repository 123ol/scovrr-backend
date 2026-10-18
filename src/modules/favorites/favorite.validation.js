const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const favoriteBody = z.object({ targetType: z.enum(['product', 'service', 'business']), targetId: objectId });
const favoriteSchema = z.object({ body: favoriteBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const removeFavoriteSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ targetType: z.enum(['product', 'service', 'business']), targetId: objectId }), query: z.record(z.never()).default({}) });
const collectionCreateSchema = z.object({ body: z.object({ name: z.string().trim().min(1).max(80) }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const collectionUpdateSchema = z.object({ body: z.object({ name: z.string().trim().min(1).max(80).optional(), status: z.enum(['active', 'archived']).optional() }).refine((body) => body.name !== undefined || body.status !== undefined, 'A collection update is required'), params: z.object({ collectionId: objectId }), query: z.record(z.never()).default({}) });
const favoriteCollectionSchema = z.object({ body: z.object({ collectionId: objectId.nullable() }), params: z.object({ targetType: z.enum(['product', 'service', 'business']), targetId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { favoriteSchema, removeFavoriteSchema, collectionCreateSchema, collectionUpdateSchema, favoriteCollectionSchema };
