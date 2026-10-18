const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const evidenceAssetIds = z.array(objectId).max(10).default([]);
const subjectTypes = z.enum(['business', 'product', 'service', 'content_post', 'review', 'user', 'message', 'conversation', 'order', 'booking']);
const reasons = z.enum(['counterfeit', 'fraud', 'misleading_content', 'inappropriate_media', 'prohibited_goods', 'spam', 'harassment', 'safety', 'payment_issue', 'privacy', 'fake_review', 'abusive_behaviour', 'privacy_violation', 'support_escalation', 'other']);
const reportBodySchema = z.object({ subjectType: subjectTypes, subjectId: objectId, reason: reasons, details: z.string().trim().max(2_000).optional(), evidenceAssetIds, evidence: z.array(z.never()).max(0).default([]) }).superRefine((value, ctx) => {
  if (value.reason === 'support_escalation' && value.subjectType !== 'conversation') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Support escalation must reference a conversation' });
});
const createReportSchema = z.object({ body: reportBodySchema, params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });
const reportIdSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const investigationSchema = reportIdSchema;
const reporterListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }) });
const adminReportListSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ status: z.enum(['open', 'in_review', 'action_required', 'resolved', 'dismissed', 'rejected']).optional(), subjectType: subjectTypes.optional(), reason: reasons.optional(), priority: z.enum(['low', 'normal', 'high', 'critical']).optional(), assignedAdminId: objectId.optional(), businessId: objectId.optional(), reporterId: objectId.optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const assignReportSchema = z.object({ body: z.object({ assignedAdminId: objectId.optional() }).default({}), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const prioritySchema = z.object({ body: z.object({ priority: z.enum(['low', 'normal', 'high', 'critical']), reason: z.string().trim().min(5).max(2_000) }), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const reviewReportSchema = z.object({ body: z.object({ note: z.string().trim().max(2_000).optional() }).default({}), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const escalateReportSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(2_000) }), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const resolveReportSchema = z.object({ body: z.object({ status: z.enum(['resolved', 'dismissed', 'rejected', 'action_required']), resolution: z.string().trim().min(1).max(2_000) }), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const attachEvidenceSchema = z.object({ body: z.object({ evidenceAssetIds: evidenceAssetIds }), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });
const noteSchema = z.object({ body: z.object({ body: z.string().trim().min(1).max(4_000) }), params: z.object({ reportId: objectId }), query: z.record(z.never()).default({}) });

module.exports = { createReportSchema, reportIdSchema, investigationSchema, reporterListSchema, adminReportListSchema, assignReportSchema, prioritySchema, reviewReportSchema, escalateReportSchema, resolveReportSchema, attachEvidenceSchema, noteSchema };
