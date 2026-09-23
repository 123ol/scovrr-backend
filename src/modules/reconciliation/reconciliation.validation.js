const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['matched', 'mismatch', 'action_required', 'resolved', 'ignored']).optional(), mismatchType: z.enum(['internal_settlement_missing', 'provider_status_mismatch', 'amount_mismatch', 'currency_mismatch', 'missing_provider_transaction', 'missing_internal_payment', 'duplicate_transaction', 'webhook_processing_failed', 'refund_mismatch', 'unknown']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const runSchema = z.object({ body: z.object({ provider: z.enum(['paystack']).default('paystack'), limit: z.number().int().min(1).max(100).default(25) }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const paymentSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ paymentId: objectId }), query: z.record(z.never()).default({}) });
const resolveSchema = z.object({ body: z.object({ status: z.enum(['resolved', 'ignored']), resolution: z.string().trim().min(5).max(2_000) }), params: z.object({ reconciliationId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { listSchema, runSchema, paymentSchema, resolveSchema };
