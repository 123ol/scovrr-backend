const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const customerDeliverySchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ orderId: objectId }), query: z.record(z.never()).default({}) });
const businessDeliverySchema = z.object({ body: z.object({ action: z.enum(['ready', 'dispatch', 'pickup', 'complete', 'picked_up', 'delivered', 'attempted']), pickupCode: z.string().regex(/^\d{6}$/).optional(), proof: z.record(z.unknown()).optional() }), params: z.object({ businessId: objectId, deliveryId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { customerDeliverySchema, businessDeliverySchema };
