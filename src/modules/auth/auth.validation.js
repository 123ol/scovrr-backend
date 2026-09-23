const { z } = require('zod');

const name = z.string().trim().min(1).max(80);
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(8).max(128);
const accountType = z.enum(['buyer', 'seller']).default('buyer');

const registerSchema = z.object({
  body: z.object({
    firstName: name,
    lastName: name,
    email,
    password,
    phone: z.string().trim().min(7).max(32).optional(),
    accountType
  }),
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
    phone: z.union([z.string().trim().min(7).max(32), z.null()]).optional()
  }).refine((value) => Object.keys(value).length > 0, { message: 'At least one profile field is required' }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

module.exports = { registerSchema, loginSchema, refreshSchema, profileUpdateSchema };
