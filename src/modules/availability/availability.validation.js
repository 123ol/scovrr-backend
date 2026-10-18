const { z } = require('zod');

const objectIdPattern = '[a-f\\d]{24}';
const objectId = z.string().regex(new RegExp(`^${objectIdPattern}$`, 'i'), 'Must be a valid identifier');
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm time format');
const interval = z.object({ start: time, end: time }).refine((value) => value.start < value.end, { path: ['end'], message: 'End time must be after start time' });
const weeklyRule = z.object({ dayOfWeek: z.number().int().min(0).max(6), intervals: z.array(interval).max(10).default([]), enabled: z.boolean().default(true) });
const override = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date format'), intervals: z.array(interval).max(10).default([]), closed: z.boolean().default(false), note: z.string().trim().max(300).optional() });
const availabilityBody = z.object({ locationId: objectId.nullable().optional(), staffUserId: objectId.nullable().optional(), timezone: z.string().trim().min(1).max(80).default('Africa/Lagos'), slotIntervalMinutes: z.number().int().min(5).max(120).default(30), weeklyRules: z.array(weeklyRule).max(7).refine((items) => new Set(items.map((item) => item.dayOfWeek)).size === items.length, 'Each weekday may only be configured once'), overrides: z.array(override).max(200).refine((items) => new Set(items.map((item) => item.date)).size === items.length, 'Each exception date may only be configured once').default([]) });
const upsertAvailabilitySchema = z.object({ body: availabilityBody, params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
// Public availability is mounted at GET /availability, so the business is
// resolved from serviceId. There is no businessId path parameter here.
const availabilityQuerySchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ serviceId: objectId, serviceIds: z.string().regex(new RegExp(`^${objectIdPattern}(,${objectIdPattern}){0,3}$`, 'i'), 'Use at most four comma-separated service identifiers').optional(), variantId: objectId.optional(), locationId: objectId.optional(), staffUserId: objectId.optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }) });
const blockBody = z.object({ locationId: objectId.nullable().optional(), staffUserId: objectId.nullable().optional(), startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), reason: z.string().trim().max(500).optional() }).refine((value) => new Date(value.endAt) > new Date(value.startAt), { path: ['endAt'], message: 'End time must be after start time' });
const createBlockSchema = z.object({ body: blockBody, params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const blockIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, blockId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { upsertAvailabilitySchema, availabilityQuerySchema, createBlockSchema, blockIdSchema, interval, weeklyRule, override };
