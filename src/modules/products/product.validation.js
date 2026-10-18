const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const media = z.object({
  url: z.string().url().max(2_000),
  provider: z.string().trim().max(80).optional(),
  publicId: z.string().trim().max(300).optional(),
  uploadSessionId: objectId.optional(),
  mimeType: z.string().trim().max(100).optional(),
  alt: z.string().trim().max(200).optional(),
  order: z.number().int().min(0).max(100).default(0),
  isCover: z.boolean().default(false)
});
const variant = z.object({
  variantId: objectId.optional(),
  name: z.string().trim().min(1).max(160),
  attributes: z.record(z.string().trim().max(80)).default({}),
  sku: z.string().trim().max(100).optional(),
  priceMinor: z.number().int().positive().optional(),
  compareAtPriceMinor: z.number().int().min(0).nullable().optional(),
  inventoryTracking: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(0),
  media: z.array(media).max(10).default([]),
  active: z.boolean().default(true)
});

const productBody = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5_000).optional(),
  shortDescription: z.string().trim().max(300).optional(),
  categoryId: objectId.optional(),
  brand: z.string().trim().max(120).optional(),
  condition: z.enum(['new', 'like_new', 'excellent', 'good', 'fair']).default('new'),
  gender: z.string().trim().max(40).optional(),
  material: z.string().trim().max(120).optional(),
  color: z.string().trim().max(80).optional(),
  size: z.string().trim().max(80).optional(),
  measurements: z.string().trim().max(160).optional(),
  weight: z.string().trim().max(80).optional(),
  sku: z.string().trim().max(100).optional(),
  fulfillment: z.enum(['delivery', 'pickup', 'arrange']).default('delivery'),
  deliveryAreas: z.string().trim().max(500).optional(),
  deliveryFeeType: z.enum(['flat', 'location']).default('flat'),
  deliveryTime: z.string().trim().max(80).optional(),
  instructions: z.string().trim().max(1_000).optional(),
  returnPolicy: z.string().trim().max(120).optional(),
  returnAddress: z.string().trim().max(500).optional(),
  paymentMethods: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  media: z.array(media).max(10).default([]),
  basePriceMinor: z.number().int().positive(),
  compareAtPriceMinor: z.number().int().min(0).nullable().optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  inventoryTracking: z.boolean().default(true),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(0),
  variants: z.array(variant).max(50).default([])
});

const createProductSchema = z.object({
  body: productBody,
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const updateProductSchema = z.object({
  body: productBody.partial(),
  params: z.object({ businessId: objectId, productId: objectId }),
  query: z.record(z.never()).default({})
});

const bulkProductPatch = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  brand: z.string().trim().max(120).optional(),
  condition: z.enum(['new', 'like_new', 'excellent', 'good', 'fair']).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  basePriceMinor: z.number().int().positive().optional(),
  compareAtPriceMinor: z.number().int().min(0).nullable().optional(),
  lowStockThreshold: z.number().int().min(0).optional()
}).strict();

const bulkUpdateProductSchema = z.object({
  body: z.object({ updates: z.array(z.object({ productId: objectId, patch: bulkProductPatch })).min(1).max(50) }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const bulkCreateProductSchema = z.object({
  body: z.object({ commit: z.boolean().default(false), products: z.array(productBody).min(1).max(25) }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const bulkCsvProductSchema = z.object({
  body: z.object({ csv: z.string().trim().min(1).max(100_000), commit: z.boolean().default(false) }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const productImportJobSchema = z.object({
  body: z.object({ csv: z.string().trim().min(1).max(100_000) }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const productImportJobIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessId: objectId, importJobId: objectId }),
  query: z.record(z.never()).default({})
});

const productIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessId: objectId, productId: objectId }),
  query: z.record(z.never()).default({})
});

const productListSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessId: objectId }),
  query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived', 'sold_out']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) })
});

const duplicateProductSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessId: objectId }),
  query: z.object({ name: z.string().trim().min(2).max(180), categoryId: objectId.optional(), productId: objectId.optional() })
});
const productExportSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessId: objectId }),
  query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived', 'sold_out']).optional(), format: z.enum(['json', 'csv']).default('json') })
});

const inventoryAdjustmentSchema = z.object({
  body: z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((value) => value !== 0, 'Delta cannot be zero'), variantId: objectId.optional(), locationId: objectId.optional(), reason: z.string().trim().max(500).optional() }),
  params: z.object({ businessId: objectId, productId: objectId }),
  query: z.record(z.never()).default({})
});

const adminProductListSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived', 'sold_out']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) })
});

const rejectProductSchema = z.object({
  body: z.object({ reason: z.string().trim().min(5).max(1_000) }),
  params: z.object({ productId: objectId }),
  query: z.record(z.never()).default({})
});

const productReviewIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ productId: objectId }),
  query: z.record(z.never()).default({})
});

module.exports = { productBody, createProductSchema, updateProductSchema, bulkUpdateProductSchema, bulkCreateProductSchema, bulkCsvProductSchema, productImportJobSchema, productImportJobIdSchema, productIdSchema, productListSchema, duplicateProductSchema, productExportSchema, inventoryAdjustmentSchema, adminProductListSchema, rejectProductSchema, productReviewIdSchema };
