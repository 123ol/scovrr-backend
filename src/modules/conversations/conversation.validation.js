const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const queryBoolean = z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return value;
}, z.boolean());
const startSchema = z.object({ body: z.object({ businessId: objectId, contextType: z.enum(['product', 'service', 'order', 'booking', 'business']).default('business'), contextId: objectId.optional(), body: z.string().trim().max(4_000).optional() }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), contextType: z.enum(['product', 'service', 'order', 'booking', 'business']).optional(), archived: queryBoolean.optional(), q: z.string().trim().min(2).max(120).optional() }) });
const conversationIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ conversationId: objectId }), query: z.record(z.never()).default({}) });
const messageListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ conversationId: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }) });
const messageSearchSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ q: z.string().trim().min(2).max(120), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), contextType: z.enum(['product', 'service', 'order', 'booking', 'business']).optional(), archived: queryBoolean.optional() }) });
const archiveSchema = z.object({ body: z.object({ archived: z.boolean() }), params: z.object({ conversationId: objectId }), query: z.record(z.never()).default({}) });
const conversationEscalationSchema = z.object({ body: z.object({ details: z.string().trim().min(5).max(2_000) }), params: z.object({ conversationId: objectId }), query: z.record(z.never()).default({}) });
const messageMedia = z.object({ evidenceId: objectId.optional(), url: z.string().url().max(2_000).nullable().optional(), mimeType: z.string().max(100).optional(), alt: z.string().max(200).optional() }).refine((value) => value.evidenceId || value.url, 'A media item needs an evidence reference or URL');
const sendMessageSchema = z.object({ body: z.object({ type: z.enum(['text', 'image']).default('text'), body: z.string().trim().max(4_000).default(''), media: z.array(messageMedia).max(8).default([]) }).refine((value) => value.body.length > 0 || value.media.length > 0, 'A message needs text or media'), params: z.object({ conversationId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { startSchema, listSchema, conversationIdSchema, messageListSchema, messageSearchSchema, archiveSchema, conversationEscalationSchema, sendMessageSchema };
