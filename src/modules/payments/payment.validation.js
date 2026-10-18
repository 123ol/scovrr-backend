const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const idempotency = z.string().trim().min(8).max(160).optional();
const initializeBody = z.object({ idempotencyKey: idempotency, provider: z.enum(['paystack']).default('paystack') });
const initializeSchema = z.object({ body: initializeBody, params: z.object({ orderId: objectId }), query: z.record(z.never()).default({}) });
const initializeBookingSchema = z.object({ body: initializeBody, params: z.object({ bookingId: objectId }), query: z.record(z.never()).default({}) });
const paymentIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ paymentId: objectId }), query: z.record(z.never()).default({}) });
const refundSchema = z.object({ body: z.object({ amountMinor: z.number().int().positive().optional(), reason: z.string().trim().min(5).max(1_000), idempotencyKey: idempotency }), params: z.object({ paymentId: objectId }), query: z.record(z.never()).default({}) });
const adminPaymentListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['initialized', 'pending', 'successful', 'failed', 'abandoned', 'reversed', 'refunded', 'partially_refunded']).optional(), type: z.enum(['order', 'booking', 'subscription']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const adminRiskListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ decision: z.enum(['allow', 'review']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });

module.exports = { initializeSchema, initializeBookingSchema, paymentIdSchema, refundSchema, adminPaymentListSchema, adminRiskListSchema };
