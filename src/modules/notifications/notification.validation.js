const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ unreadOnly: z.enum(['true', 'false']).default('false'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) }) });
const notificationIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ notificationId: objectId }), query: z.record(z.never()).default({}) });
const deviceSchema = z.object({ body: z.object({ token: z.string().trim().min(10).max(500), platform: z.enum(['ios', 'android', 'web', 'unknown']).default('unknown'), deviceId: z.string().trim().max(200).optional(), appVersion: z.string().trim().max(50).optional() }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const deviceDeleteSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ token: z.string().min(10).max(500) }), query: z.record(z.never()).default({}) });

module.exports = { listSchema, notificationIdSchema, deviceSchema, deviceDeleteSchema };
