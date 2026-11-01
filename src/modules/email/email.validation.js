const { z } = require('zod');

const emptyParams = z.record(z.never()).default({});

const adminListSchema = z.object({
  body: z.record(z.never()).default({}),
  params: emptyParams,
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['queued', 'sending', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'dead']).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    templateKey: z.string().trim().min(1).max(100).optional()
  })
});

const retrySchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ deliveryId: z.string().regex(/^[a-f\d]{24}$/i) }), query: emptyParams });
const announcementSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2_000),
    userIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100),
    ctaLabel: z.string().trim().max(80).optional(),
    ctaUrl: z.string().url().max(500).optional()
  }).strict(),
  params: emptyParams,
  query: emptyParams
});

module.exports = { adminListSchema, retrySchema, announcementSchema };
