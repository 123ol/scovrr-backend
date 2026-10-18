const { z } = require('zod');
const { CLIENT_EVENT_NAMES, LEGACY_EVENT_NAMES, EVENT_SOURCES, EVENT_PLATFORMS, getEventDefinition } = require('./event-registry');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const eventName = z.enum([...CLIENT_EVENT_NAMES, ...Object.keys(LEGACY_EVENT_NAMES).filter((name) => getEventDefinition(name)?.clientAllowed)]);
const scalar = z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]);
const metadata = z.record(scalar).default({}).refine((value) => JSON.stringify(value).length <= 2_500, 'Event metadata is too large');
const eventBody = z.object({
  eventName, clientEventId: z.string().trim().min(8).max(120).optional(), anonymousSessionId: z.string().trim().min(8).max(120).optional(), sessionId: z.string().trim().min(8).max(120).optional(),
  entityType: z.enum(['business', 'product', 'service', 'content_post', 'category', 'order', 'booking', 'conversation']).optional(), entityId: objectId.optional(),
  source: z.enum(EVENT_SOURCES).optional(), placement: z.string().trim().max(80).optional(), platform: z.enum(EVENT_PLATFORMS).optional(), appVersion: z.string().trim().max(40).optional(),
  attribution: z.object({ source: z.string().max(80).optional(), campaign: z.string().max(120).optional(), medium: z.string().max(80).optional() }).strict().optional(),
  metadata, properties: metadata, occurredAt: z.string().datetime({ offset: true }).optional()
}).strict();
const createEventSchema = z.object({ body: eventBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const batchEventSchema = z.object({ body: z.object({ events: z.array(eventBody).min(1).max(50) }).strict(), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

module.exports = { createEventSchema, batchEventSchema };
