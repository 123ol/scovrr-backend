const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), status: z.string().optional() });
const targeting = z.object({ country: z.string().trim().max(120).optional().nullable(), state: z.string().trim().max(120).optional().nullable(), city: z.string().trim().max(120).optional().nullable(), area: z.string().trim().max(120).optional().nullable(), radiusKm: z.number().positive().max(250).optional().nullable(), locationIds: z.array(objectId).max(50).default([]), categoryIds: z.array(objectId).max(50).default([]) }).default({});
const campaignFields = {
  name: z.string().trim().min(2).max(140), targetType: z.enum(['BUSINESS', 'PRODUCT', 'SERVICE']).default('BUSINESS'), targetId: objectId.optional(), objective: z.enum(['awareness', 'traffic', 'sales', 'bookings', 'followers']).default('awareness'),
  startAt: z.string().datetime({ offset: true }), endAt: z.string().datetime({ offset: true }), timezone: z.string().trim().max(80).default('Africa/Lagos'), currency: z.string().trim().toUpperCase().length(3).default('NGN'),
  budgetMinor: z.number().int().min(100), dailyBudgetMinor: z.number().int().min(100).nullable().optional(), targeting, placements: z.array(z.enum(['DISCOVER_HOME', 'SEARCH_RESULTS', 'CATEGORY_RESULTS', 'BUSINESS_DISCOVERY', 'PRODUCT_DISCOVERY', 'SERVICE_DISCOVERY'])).min(1).max(6)
};
const createSchema = z.object({ body: z.object(campaignFields).refine((value) => new Date(value.endAt) > new Date(value.startAt), { path: ['endAt'], message: 'End time must be after start time' }), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const updateSchema = z.object({ body: z.object(campaignFields).partial(), params: z.object({ businessId: objectId, campaignId: objectId }), query: z.record(z.never()).default({}) });
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query });
const campaignIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, campaignId: objectId }), query: z.record(z.never()).default({}) });
const fundSchema = z.object({ body: z.object({ idempotencyKey: z.string().trim().min(12).max(160).optional(), provider: z.string().trim().max(50).optional() }).default({}), params: z.object({ businessId: objectId, campaignId: objectId }), query: z.record(z.never()).default({}) });
const metricSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, campaignId: objectId }), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(31) }) });
const eventSchema = z.object({ body: z.object({ token: z.string().trim().min(20).max(2_000), sessionKey: z.string().trim().max(160).optional(), conversionId: z.string().trim().max(160).optional() }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

module.exports = { createSchema, updateSchema, listSchema, campaignIdSchema, fundSchema, metricSchema, eventSchema };
