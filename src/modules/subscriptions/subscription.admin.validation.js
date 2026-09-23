const { z } = require('zod');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const emptyBody = z.record(z.never()).default({});
const prices = z.array(z.object({ billingInterval: z.enum(['monthly', 'yearly']), amountMinor: z.number().int().min(0), currency: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()) })).min(1).max(2);
const entitlements = z.record(z.union([z.boolean(), z.number().int().min(0), z.null()]));
const planCreateSchema = z.object({ body: z.object({ code: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9_]+$/).transform((value) => value.toUpperCase()), name: z.string().trim().min(2).max(100), description: z.string().trim().max(1_000).default(''), displayOrder: z.number().int().min(0).default(0), trialEligible: z.boolean().default(false), public: z.boolean().default(true) }), params: emptyBody, query: emptyBody });
const planVersionCreateSchema = z.object({ body: z.object({ prices, entitlements, metadata: z.record(z.any()).default({}) }), params: z.object({ planId: objectId }), query: emptyBody });
const planVersionIdSchema = z.object({ body: emptyBody, params: z.object({ planVersionId: objectId }), query: emptyBody });
const subscriptionListSchema = z.object({ body: emptyBody, params: emptyBody, query: z.object({ status: z.enum(['trialing', 'trial', 'active', 'past_due', 'grace_period', 'cancel_at_period_end', 'cancelled', 'expired', 'suspended']).optional(), planKey: z.string().trim().max(50).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const businessIdSchema = z.object({ body: emptyBody, params: z.object({ businessId: objectId }), query: emptyBody });
const overrideSchema = z.object({ body: z.object({ entitlementKey: z.string().trim().min(3).max(120), operation: z.enum(['replace', 'add']).default('replace'), value: z.union([z.boolean(), z.number().int().min(0), z.null()]), reason: z.string().trim().min(5).max(1_000), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().nullable().optional() }), params: z.object({ businessId: objectId }), query: emptyBody });
const overrideRevokeSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(1_000) }), params: z.object({ overrideId: objectId }), query: emptyBody });

module.exports = { planCreateSchema, planVersionCreateSchema, planVersionIdSchema, subscriptionListSchema, businessIdSchema, overrideSchema, overrideRevokeSchema };
