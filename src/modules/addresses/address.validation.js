const { z } = require('zod');
const { normalizePhone } = require('../../common/phone');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const coordinates = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const phone = z.string().trim().min(7).max(32).transform((value, context) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number, including country code when outside Nigeria' });
    return z.NEVER;
  }
  return normalized;
});
const addressBody = z.object({
  label: z.enum(['Home', 'Work', 'Other']),
  recipientName: z.string().trim().min(1).max(120),
  phone,
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  area: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(1).max(120),
  country: z.string().trim().min(1).max(120),
  landmark: z.string().trim().max(200).optional(),
  coordinates: coordinates.optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  isDefault: z.boolean().default(false)
});

const createAddressSchema = z.object({ body: addressBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const updateAddressSchema = z.object({ body: addressBody.partial(), params: z.object({ addressId: objectId }), query: z.record(z.never()).default({}) });
const addressIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ addressId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { createAddressSchema, updateAddressSchema, addressIdSchema };
