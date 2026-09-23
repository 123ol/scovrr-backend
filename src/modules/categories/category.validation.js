const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const categoryType = z.enum(['product', 'service', 'both']);

const createCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(100),
    slug: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().max(120).optional(),
    image: z.string().url().max(2_000).optional(),
    parentId: objectId.nullable().optional(),
    type: categoryType.default('both'),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    enabled: z.boolean().default(true),
    metadata: z.record(z.unknown()).optional()
  }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const updateCategorySchema = z.object({
  body: createCategorySchema.shape.body.partial(),
  params: z.object({ categoryId: objectId }),
  query: z.record(z.never()).default({})
});

const listCategorySchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({
    type: categoryType.optional(),
    includeDisabled: z.enum(['true', 'false']).optional()
  })
});

module.exports = { createCategorySchema, updateCategorySchema, listCategorySchema };
