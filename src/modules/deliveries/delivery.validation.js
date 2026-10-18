const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const customerDeliverySchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ orderId: objectId }), query: z.record(z.never()).default({}) });
const deliveryProofSchema = z.object({ note: z.string().trim().max(500).optional(), evidenceAssetIds: z.array(objectId).max(3).default([]) }).passthrough();
const courierAssignmentSchema = z.object({ name: z.string().trim().min(2).max(140), phone: z.string().trim().max(32).optional(), note: z.string().trim().max(300).optional() }).strict();
const businessDeliverySchema = z.object({ body: z.object({ action: z.enum(['ready', 'schedule_pickup', 'assign', 'dispatch', 'pickup', 'complete', 'picked_up', 'delivered', 'attempted', 'failed', 'retry']), pickupCode: z.string().regex(/^\d{6}$/).optional(), estimatedPickupAt: z.string().datetime({ offset: true }).optional(), courier: courierAssignmentSchema.optional(), proof: deliveryProofSchema.optional() }).superRefine((body, context) => { if (body.action === 'assign' && !body.courier) context.addIssue({ code: 'custom', path: ['courier'], message: 'Courier details are required when assigning delivery' }); }), params: z.object({ businessId: objectId, deliveryId: objectId }), query: z.record(z.never()).default({}) });
const businessDeliveryGetSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, deliveryId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { customerDeliverySchema, businessDeliverySchema, businessDeliveryGetSchema, deliveryProofSchema, courierAssignmentSchema };
