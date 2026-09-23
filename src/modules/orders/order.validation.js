const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const checkoutBody = z.object({ idempotencyKey: z.string().trim().min(8).max(160).optional(), addressId: objectId.optional(), fulfillmentLocationId: objectId.optional(), fulfillmentMethod: z.enum(['delivery', 'pickup']).default('delivery'), deliveryMethod: z.enum(['customer_pickup', 'seller_delivery', 'third_party']).optional(), couponCode: z.string().trim().toUpperCase().min(3).max(40).optional() });
const checkoutSchema = z.object({ body: checkoutBody, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const orderIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ orderId: objectId }), query: z.record(z.never()).default({}) });
const businessOrderListSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ status: z.enum(['pending_payment', 'paid', 'confirmed', 'processing', 'ready_for_pickup', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'refunded']).optional(), locationId: objectId.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const businessOrderActionSchema = z.object({ body: z.object({ action: z.enum(['accept', 'process', 'ready', 'cancel']), reason: z.string().trim().max(500).optional() }), params: z.object({ businessId: objectId, orderId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { checkoutSchema, orderIdSchema, businessOrderListSchema, businessOrderActionSchema };
