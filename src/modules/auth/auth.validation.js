const { z } = require('zod');

const name = z.string().trim().min(1).max(80);
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(8).max(128);
const accountType = z.enum(['buyer', 'seller']).default('buyer');
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
    phone: z.string().trim().min(7).max(32).optional(),
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
    phone: z.union([z.string().trim().min(7).max(32), z.null()]).optional(),
    location: z.union([savedLocation, z.null()]).optional()
  }).refine((value) => Object.keys(value).length > 0, { message: 'At least one profile field is required' }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

module.exports = { registerSchema, loginSchema, refreshSchema, profileUpdateSchema };
