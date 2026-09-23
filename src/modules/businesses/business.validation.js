const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const capabilities = z.array(z.enum(['marketplace', 'services'])).min(1).max(2).refine((values) => new Set(values).size === values.length, 'Capabilities must be unique');
const operatingModel = z.enum(['physical_store', 'online_only', 'home_based', 'multiple_locations', 'mobile_professional']);
const coordinatePair = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90)
]);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm time format');
const openingInterval = z.object({ start: time, end: time }).refine((value) => value.start < value.end, { path: ['end'], message: 'End time must be after start time' });
const openingHours = z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), intervals: z.array(openingInterval).max(10).default([]), closed: z.boolean().default(false) })).max(7).refine((items) => new Set(items.map((item) => item.dayOfWeek)).size === items.length, 'Each weekday may only be configured once');
const specialHours = z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), intervals: z.array(openingInterval).max(10).default([]), closed: z.boolean().default(false), note: z.string().trim().max(300).optional() })).max(370);
const delivery = z.object({ enabled: z.boolean().default(false), flatFeeMinor: z.number().int().min(0).default(0), freeDeliveryThresholdMinor: z.number().int().min(0).nullable().default(null), estimatedDeliveryMinutes: z.number().int().min(1).max(10_080).default(120) });

const createBusinessSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(140),
    description: z.string().trim().max(2_000).optional(),
    capabilities,
    categoryIds: z.array(objectId).max(20).default([]),
    operatingModel
  }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const capabilitiesSchema = z.object({
  body: z.object({ capabilities }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const locationBody = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,32}$/).optional(),
  address: z.object({
    addressLine1: z.string().trim().max(200).optional(),
    addressLine2: z.string().trim().max(200).optional(),
    area: z.string().trim().max(120).optional(),
    city: z.string().trim().min(1).max(120),
    state: z.string().trim().min(1).max(120),
    country: z.string().trim().min(1).max(120),
    landmark: z.string().trim().max(200).optional()
  }),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  coordinates: coordinatePair.optional(),
  timezone: z.string().trim().min(1).max(80).default('Africa/Lagos'),
  openingHours: openingHours.default([]),
  specialHours: specialHours.default([]),
  publiclyVisible: z.boolean().default(true),
  publicExactAddress: z.boolean().default(true),
  serviceAvailable: z.boolean().default(true),
  pickupAvailable: z.boolean().default(false),
  pickupInstructions: z.string().trim().max(1_000).default(''),
  pickupPreparationMinutes: z.number().int().min(0).max(10_080).default(30),
  delivery: delivery.default({}),
  primary: z.boolean().default(false),
  active: z.boolean().default(true)
});

const createLocationSchema = z.object({
  body: locationBody,
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const updateLocationSchema = z.object({
  body: locationBody.partial(),
  params: z.object({ businessId: objectId, locationId: objectId }),
  query: z.record(z.never()).default({})
});

const businessIdSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const listAdminBusinessesSchema = z.object({
  body: z.record(z.never()).default({}),
  params: z.record(z.never()).default({}),
  query: z.object({
    status: z.enum(['draft', 'pending_review', 'active', 'suspended', 'rejected', 'closed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25)
  })
});

const rejectBusinessSchema = z.object({
  body: z.object({ reason: z.string().trim().min(5).max(1_000), adminNotes: z.string().trim().max(5_000).optional() }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

const businessStatusSchema = z.object({
  body: z.object({ reason: z.string().trim().min(5).max(2_000) }),
  params: z.object({ businessId: objectId }),
  query: z.record(z.never()).default({})
});

module.exports = { createBusinessSchema, capabilitiesSchema, createLocationSchema, updateLocationSchema, businessIdSchema, listAdminBusinessesSchema, rejectBusinessSchema, businessStatusSchema };
