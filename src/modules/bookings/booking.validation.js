const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const dateTime = z.string().datetime({ offset: true });
const createBookingSchema = z.object({
  body: z.object({
    serviceId: objectId,
    variantId: objectId.optional(),
    staffUserId: objectId.optional(),
    startAt: dateTime,
    locationType: z.enum(['at_business', 'at_customer', 'online', 'mobile']),
    locationId: objectId.optional(),
    addressId: objectId.optional(),
    customerNotes: z.string().trim().max(2_000).optional(),
    requestType: z.enum(['instant', 'request']).default('request'),
    couponCode: z.string().trim().toUpperCase().min(3).max(40).optional(),
    clientRequestId: z.string().trim().min(8).max(120).optional()
  }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});
const bookingIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ bookingId: objectId }), query: z.record(z.never()).default({}) });
const bookingListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['pending_payment', 'requested', 'confirmed', 'upcoming', 'checked_in', 'in_progress', 'reschedule_requested', 'rejected', 'cancelled_by_customer', 'cancelled_by_business', 'no_show', 'completed', 'refund_pending', 'refunded', 'disputed']).optional(), from: dateTime.optional(), to: dateTime.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const businessBookingListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: bookingListSchema.shape.query });
const businessBookingIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, bookingId: objectId }), query: z.record(z.never()).default({}) });
const actionSchema = z.object({ body: z.object({ reason: z.string().trim().max(500).optional() }), params: z.object({ bookingId: objectId }), query: z.record(z.never()).default({}) });
const transitionSchema = z.object({ body: z.object({ action: z.enum(['accept', 'reject', 'confirm', 'check_in', 'start', 'complete', 'no_show', 'cancel']), reason: z.string().trim().max(500).optional() }), params: z.object({ bookingId: objectId }), query: z.record(z.never()).default({}) });
const rescheduleSchema = z.object({ body: z.object({ startAt: dateTime, reason: z.string().trim().max(500).optional(), clientRequestId: z.string().trim().min(8).max(120).optional() }), params: z.object({ bookingId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { createBookingSchema, bookingIdSchema, bookingListSchema, businessBookingListSchema, businessBookingIdSchema, actionSchema, transitionSchema, rescheduleSchema };
