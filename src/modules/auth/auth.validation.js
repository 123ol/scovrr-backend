const { z } = require('zod');
const { normalizePhone } = require('../../common/phone');

const name = z.string().trim().min(1).max(80);
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(8).max(128);
const accountType = z.enum(['buyer', 'seller']).default('buyer');
const phone = z.string().trim().min(7).max(32).transform((value, context) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number, including country code when outside Nigeria' });
    return z.NEVER;
  }
  return normalized;
});
const coordinates = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const savedLocation = z.object({
  coordinates,
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  area: z.string().trim().max(120).optional(),
  accuracy: z.number().min(0).nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }).optional()
});

const registerBody = z.object({
    firstName: name,
    lastName: name,
    email,
    password,
    phone: phone.optional(),
    accountType,
    location: savedLocation.optional()
  }).superRefine((value, context) => {
    if (value.accountType === 'seller' && !value.location) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['location'], message: 'Seller location is required' });
    }
  });

const registerSchema = z.object({
  body: registerBody,
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const loginSchema = z.object({
  body: z.object({ email, password }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(32).max(256) }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const profileUpdateSchema = z.object({
  body: z.object({
    firstName: name.optional(),
    lastName: name.optional(),
    phone: z.union([phone, z.null()]).optional(),
    location: z.union([savedLocation, z.null()]).optional()
  }).refine((value) => Object.keys(value).length > 0, { message: 'At least one profile field is required' }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const preferenceUpdateSchema = z.object({
  body: z.object({
    orderUpdates: z.boolean().optional(),
    bookingUpdates: z.boolean().optional(),
    messages: z.boolean().optional(),
    marketing: z.boolean().optional(),
    security: z.boolean().optional()
  }).refine((value) => Object.keys(value).length > 0, { message: 'At least one preference is required' }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const privacyConsentSchema = z.object({
  body: z.object({ accepted: z.literal(true), policyVersion: z.string().trim().min(1).max(40) }).strict(),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});
const privacyConsentReadSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

const deactivateSchema = z.object({
  body: z.object({ reason: z.string().trim().max(500).optional() }).default({}),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const sessionIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ sessionId: z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier') }),
  query: z.record(z.never()).default({})
});

const sessionsSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const exportJobIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ exportJobId: z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier') }),
  query: z.record(z.never()).default({})
});

const deletionRequestIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ requestId: z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier') }),
  query: z.record(z.never()).default({})
});
const deletionRequestSchema = z.object({
  body: z.object({ reason: z.string().trim().max(500).optional() }).strict().default({}),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});
const deletionRequestReviewSchema = z.object({
  body: z.object({ action: z.enum(['start_review', 'reject']), reason: z.string().trim().min(5).max(2_000) }).strict(),
  params: z.object({ requestId: z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier') }),
  query: z.record(z.never()).default({})
});
const deletionRequestListSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({ status: z.enum(['requested', 'under_review', 'rejected', 'cancelled']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) })
});
const lifecyclePolicySchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

module.exports = { registerSchema, loginSchema, refreshSchema, profileUpdateSchema, preferenceUpdateSchema, privacyConsentSchema, privacyConsentReadSchema, deactivateSchema, sessionIdSchema, sessionsSchema, exportJobIdSchema, deletionRequestIdSchema, deletionRequestSchema, deletionRequestReviewSchema, deletionRequestListSchema, lifecyclePolicySchema };
