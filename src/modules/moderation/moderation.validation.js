const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const caseIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ caseId: objectId }), query: z.record(z.never()).default({}) });
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['pending', 'under_review', 'action_required', 'approved', 'rejected', 'removed', 'dismissed']).optional(), subjectType: z.enum(['business', 'product', 'service', 'content_post', 'review', 'portfolio_item']).optional(), source: z.enum(['report', 'admin', 'automated', 'verification', 'system']).optional(), severity: z.enum(['low', 'medium', 'high', 'critical']).optional(), assignedModeratorId: objectId.optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const assignSchema = z.object({ body: z.object({ assignedModeratorId: objectId.optional() }).default({}), params: z.object({ caseId: objectId }), query: z.record(z.never()).default({}) });
const decisionSchema = z.object({ body: z.object({ outcome: z.enum(['approved', 'rejected', 'removed', 'dismissed', 'action_required']), note: z.string().trim().min(1).max(4_000) }), params: z.object({ caseId: objectId }), query: z.record(z.never()).default({}) });
const bulkDecisionSchema = z.object({ body: z.object({ caseIds: z.array(objectId).min(1).max(50), outcome: z.enum(['approved', 'rejected', 'removed', 'dismissed', 'action_required']), note: z.string().trim().min(1).max(4_000) }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const noteSchema = z.object({ body: z.object({ body: z.string().trim().min(1).max(4_000) }), params: z.object({ caseId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { caseIdSchema, listSchema, assignSchema, decisionSchema, bulkDecisionSchema, noteSchema };
