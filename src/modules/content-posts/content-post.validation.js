const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const media = z.object({
  url: z.string().url().max(2_000),
  provider: z.string().trim().max(80).optional(),
  publicId: z.string().trim().max(300).optional(),
  uploadSessionId: objectId.optional(),
  mimeType: z.string().trim().max(100).optional(),
  alt: z.string().trim().max(200).optional(),
  order: z.number().int().min(0).max(20).default(0)
});

const postBodyShape = z.object({
  type: z.enum(['announcement', 'product_update', 'service_update', 'offer', 'tip']).default('announcement'),
  title: z.string().trim().max(180).default(''),
  body: z.string().trim().max(5_000).default(''),
  media: z.array(media).max(10).default([]),
  linkedProductId: objectId.optional().nullable(),
  linkedServiceId: objectId.optional().nullable()
});

function withValidLinks(schema) {
  return schema.superRefine((value, context) => {
  if (value.linkedProductId && value.linkedServiceId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['linkedProductId'], message: 'A post can link to a product or a service, not both' });
  });
}

const postBody = withValidLinks(postBodyShape);
const createSchema = z.object({ body: postBody, params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const updateSchema = z.object({ body: withValidLinks(postBodyShape.partial()), params: z.object({ businessId: objectId, postId: objectId }), query: z.record(z.never()).default({}) });
const postIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, postId: objectId }), query: z.record(z.never()).default({}) });
const adminPostIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ postId: objectId }), query: z.record(z.never()).default({}) });
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const publicListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessSlug: z.string().trim().min(1).max(120) }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(20).default(10) }) });
const commentCreateSchema = z.object({ body: z.object({ body: z.string().trim().min(1).max(1_000) }), params: z.object({ postId: objectId }), query: z.record(z.never()).default({}) });
const commentListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ postId: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) });
const likeSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ postId: objectId }), query: z.record(z.never()).default({}) });
const adminListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const rejectSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(1_000) }), params: z.object({ postId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { createSchema, updateSchema, postIdSchema, adminPostIdSchema, listSchema, publicListSchema, commentCreateSchema, commentListSchema, likeSchema, adminListSchema, rejectSchema };
