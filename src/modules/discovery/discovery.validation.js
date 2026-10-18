const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');

const discoverSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({
    q: z.string().trim().max(120).optional(),
    postId: objectId.optional(),
    type: z.enum(['all', 'products', 'services', 'businesses', 'posts']).default('all'),
    feed: z.enum(['all', 'following', 'nearby', 'trending', 'personalized']).default('all'),
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
    ,minPriceMinor: z.coerce.number().int().min(0).optional()
    ,maxPriceMinor: z.coerce.number().int().min(0).optional()
    ,ratingMin: z.coerce.number().min(0).max(5).optional()
    ,condition: z.enum(['new', 'like_new', 'excellent', 'good', 'fair']).optional()
    ,locationType: z.enum(['at_business', 'at_customer', 'online', 'mobile']).optional()
  }).superRefine((query, context) => {
    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;
    if (hasLatitude !== hasLongitude) context.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message: 'Latitude and longitude must be supplied together' });
    if (query.minPriceMinor !== undefined && query.maxPriceMinor !== undefined && query.minPriceMinor > query.maxPriceMinor) context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxPriceMinor'], message: 'Maximum price must be greater than minimum price' });
  })
});

const nearbySchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().min(0.1).max(100).default(25), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) })
});

module.exports = { discoverSchema, nearbySchema };
