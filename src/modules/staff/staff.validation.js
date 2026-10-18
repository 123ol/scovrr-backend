const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const roles = z.enum(['administrator', 'manager', 'inventory_manager', 'order_manager', 'order_staff', 'booking_manager', 'booking_staff', 'professional', 'customer_support', 'finance', 'finance_staff']);
const locationAccess = z.object({ mode: z.enum(['all', 'selected']).default('all'), locationIds: z.array(objectId).max(50).default([]) });
const listQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50), status: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional() });
const listMembersSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: listQuery.omit({ status: true }) });
const listInvitationsSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: listQuery });
const listActivitySchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId }), query: z.object({ action: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }) });
const addMemberSchema = z.object({ body: z.object({ email: z.string().email().max(254), role: roles, locationAccess: locationAccess.optional() }), params: z.object({ businessId: objectId }), query: z.record(z.never()).default({}) });
const updateMemberSchema = z.object({ body: z.object({ role: roles.optional(), status: z.enum(['active', 'suspended', 'revoked']).optional(), locationAccess: locationAccess.optional() }).refine((value) => value.role !== undefined || value.status !== undefined || value.locationAccess !== undefined, 'At least one membership field is required'), params: z.object({ businessId: objectId, membershipId: objectId }), query: z.record(z.never()).default({}) });
const invitationIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ businessId: objectId, invitationId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { listMembersSchema, listInvitationsSchema, listActivitySchema, addMemberSchema, updateMemberSchema, invitationIdSchema };
