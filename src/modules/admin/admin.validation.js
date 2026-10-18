const { z } = require('zod');
const { SYSTEM_ADMIN_ROLE_NAMES } = require('./admin-permissions');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const roles = z.array(z.enum(SYSTEM_ADMIN_ROLE_NAMES)).min(1).max(SYSTEM_ADMIN_ROLE_NAMES.length);
const emptyBody = z.record(z.never()).default({});

const adminListSchema = z.object({ body: emptyBody, params: z.record(z.never()).default({}), query: z.object({ search: z.string().trim().max(120).optional(), status: z.enum(['active', 'suspended', 'deactivated', 'pending_verification']).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const userListSchema = z.object({ body: emptyBody, params: z.record(z.never()).default({}), query: z.object({ search: z.string().trim().max(120).optional(), status: z.enum(['active', 'suspended', 'deactivated', 'pending_verification']).optional(), accountType: z.enum(['buyer', 'seller']).optional(), emailVerified: z.enum(['true', 'false']).optional(), phoneVerified: z.enum(['true', 'false']).optional(), createdFrom: z.coerce.date().optional(), createdTo: z.coerce.date().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) }).refine((query) => !query.createdFrom || !query.createdTo || query.createdFrom <= query.createdTo, { path: ['createdTo'], message: 'createdTo must be on or after createdFrom' }) });
const inviteAdminSchema = z.object({ body: z.object({ email: z.string().email().max(254), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), roles }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const adminIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ adminId: objectId }), query: z.record(z.never()).default({}) });
const updateRolesSchema = z.object({ body: z.object({ roles, reason: z.string().trim().min(5).max(2_000) }), params: z.object({ adminId: objectId }), query: z.record(z.never()).default({}) });
const adminStatusSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(2_000) }), params: z.object({ adminId: objectId }), query: z.record(z.never()).default({}) });
const userStatusSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(2_000) }), params: z.object({ userId: objectId }), query: z.record(z.never()).default({}) });
const operationsJobsSchema = z.object({ body: emptyBody, params: z.record(z.never()).default({}), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(25) }) });
const jobReplaySchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(2_000) }).strict(), params: z.object({ jobId: objectId }), query: z.record(z.never()).default({}) });
const acceptInvitationSchema = z.object({ body: z.object({ password: z.string().min(12).max(200).optional() }), params: z.object({ token: z.string().min(40).max(200) }), query: z.record(z.never()).default({}) });

module.exports = { adminListSchema, userListSchema, inviteAdminSchema, adminIdSchema, updateRolesSchema, adminStatusSchema, userStatusSchema, operationsJobsSchema, jobReplaySchema, acceptInvitationSchema };
