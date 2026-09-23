const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const targetType = z.enum(['marketplace', 'product']);
const status = z.enum(['draft', 'active', 'archived']);

const slideFields = {
  eyebrow: z.string().trim().max(80).default('NEW ARRIVALS'),
  title: z.string().trim().min(2).max(180),
  subtitle: z.string().trim().max(300).default(''),
  imageUrl: z.string().url().max(2_000),
  targetType: targetType.default('marketplace'),
  productId: objectId.nullable().default(null),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  status: status.default('draft'),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null)
};

function validateDatesAndTarget(value, context) {
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'End date must be after the start date' });
  }
  if (value.targetType === 'product' && !value.productId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['productId'], message: 'A product is required for a product slide' });
  }
  if (value.targetType === 'marketplace' && value.productId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['productId'], message: 'Marketplace slides cannot have a product destination' });
  }
}

const createHomeSlideSchema = z.object({
  body: z.object(slideFields).superRefine(validateDatesAndTarget),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const updateHomeSlideSchema = z.object({
  body: z.object(slideFields).partial(),
  params: z.object({ slideId: objectId }),
  query: z.record(z.never()).default({})
});

const listHomeSlideSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({
    status: status.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

const homeSlideIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ slideId: objectId }),
  query: z.record(z.never()).default({})
});

const publicHomeSlideSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) })
});

module.exports = { createHomeSlideSchema, updateHomeSlideSchema, listHomeSlideSchema, homeSlideIdSchema, publicHomeSlideSchema };
