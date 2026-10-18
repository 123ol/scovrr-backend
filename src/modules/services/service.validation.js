const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const media = z.object({
  url: z.string().url().max(2_000),
  provider: z.string().trim().max(80).optional(),
  publicId: z.string().trim().max(300).optional(),
  uploadSessionId: objectId.optional(),
  mimeType: z.string().trim().max(100).optional(),
  alt: z.string().trim().max(200).optional(),
  order: z.number().int().min(0).max(100).default(0),
  isCover: z.boolean().default(false)
});
const variant = z.object({
  variantId: objectId.optional(),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(500).optional(),
  priceMinor: z.number().int().positive(),
  durationMinutes: z.number().int().min(5).max(1_440),
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  media: z.array(media).max(10).default([]),
  active: z.boolean().default(true)
});
const staffAssignment = z.object({ staffUserId: objectId, locationIds: z.array(objectId).max(50).default([]) });
const serviceBodyShape = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(5_000).optional(),
  shortDescription: z.string().trim().max(300).optional(),
  subcategory: z.string().trim().max(120).optional(),
  serviceType: z.enum(['service', 'consultation']).default('service'),
  audience: z.string().trim().max(40).optional(),
  experience: z.string().trim().max(80).optional(),
  yearsExperience: z.string().trim().max(80).optional(),
  highlights: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  included: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  process: z.array(z.object({ title: z.string().trim().min(1).max(160), body: z.string().trim().max(500) })).max(20).default([]),
  bestFor: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  requirements: z.string().trim().max(1_000).optional(),
  notes: z.string().trim().max(1_000).optional(),
  bookingType: z.string().trim().max(80).default('Fixed Time'),
  maxBookingsPerDay: z.number().int().min(1).max(1_000).default(8),
  sameDayBooking: z.boolean().default(false),
  autoAcceptBookings: z.boolean().default(false),
  approvalRequired: z.boolean().default(false),
  categoryId: objectId.optional(),
  media: z.array(media).max(10).default([]),
  basePriceMinor: z.number().int().positive(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  durationMinutes: z.number().int().min(5).max(1_440),
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(240).default(0),
  locationTypes: z.array(z.enum(['at_business', 'at_customer', 'online', 'mobile'])).min(1).max(4),
  paymentRule: z.enum(['full', 'deposit']).default('full'),
  depositAmountMinor: z.number().int().min(0).default(0),
  cancellationWindowHours: z.number().int().min(0).max(720).default(24),
  minNoticeMinutes: z.number().int().min(0).max(43_200).default(60),
  maxAdvanceDays: z.number().int().min(1).max(730).default(90),
  locationIds: z.array(objectId).max(50).default([]),
  staffUserIds: z.array(objectId).max(50).default([]),
  staffAssignments: z.array(staffAssignment).max(100).default([]),
  variants: z.array(variant).max(50).default([])
});
const serviceBody = serviceBodyShape.superRefine((value, context) => {
  if (value.paymentRule === 'deposit' && (!value.depositAmountMinor || value.depositAmountMinor >= value.basePriceMinor)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['depositAmountMinor'], message: 'Deposit must be greater than zero and less than the service price' });
  if (value.variants.some((item) => item.priceMinor <= 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['variants'], message: 'Service variants must have a positive price' });
});
const createServiceSchema = z.object({ body: serviceBody, params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const updateServiceSchema = z.object({ body: serviceBodyShape.partial(), params: z.object({ businessId: objectId, serviceId: objectId }), query: z.record(z.never()).default({}) });
const serviceIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, serviceId: objectId }), query: z.record(z.never()).default({}) });
const serviceListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const publicServiceListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({}).default({}), query: z.object({ q: z.string().trim().max(120).optional(), categoryId: objectId.optional(), businessSlug: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), sort: z.enum(['newest', 'price_low', 'price_high']).default('newest') }) });
const publicBusinessServiceListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessSlug: z.string().trim().min(1).max(120) }), query: publicServiceListSchema.shape.query.omit({ businessSlug: true }) });
const publicServiceBySlugSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ slug: z.string().trim().min(1).max(180) }), query: z.record(z.never()).default({}) });
const rejectServiceSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(1_000) }), params: z.object({ serviceId: objectId }), query: z.record(z.never()).default({}) });
const serviceReviewIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ serviceId: objectId }), query: z.record(z.never()).default({}) });
const adminServiceListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['draft', 'pending_review', 'active', 'rejected', 'archived']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });

module.exports = { createServiceSchema, updateServiceSchema, serviceIdSchema, serviceListSchema, publicServiceListSchema, publicBusinessServiceListSchema, publicServiceBySlugSchema, rejectServiceSchema, serviceReviewIdSchema, adminServiceListSchema };
