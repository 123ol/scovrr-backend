const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');

const discoverSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({
    q: z.string().trim().max(120).optional(),
    type: z.enum(['all', 'products', 'services', 'businesses', 'posts']).default('all'),
    postType: z.enum(['product_update', 'service_update', 'updates']).optional(),
    categoryId: objectId.optional(),
    categorySlug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a valid category slug').max(120).optional(),
    city: z.string().trim().max(120).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(0.1).max(100).default(25),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    sort: z.enum(['newest', 'price_low', 'price_high']).default('newest')
  }).superRefine((query, context) => {
    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;
    if (hasLatitude !== hasLongitude) context.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message: 'Latitude and longitude must be supplied together' });
  })
});

module.exports = { discoverSchema };
