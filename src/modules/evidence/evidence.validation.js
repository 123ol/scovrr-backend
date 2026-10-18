const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid identifier');
const imageMime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const sessionSchema = z.object({
  body: z.object({
    purpose: z.enum(['report', 'dispute', 'message', 'verification', 'delivery']),
    mimeType: imageMime,
    subjectType: z.enum(['business', 'product', 'service', 'review', 'user', 'message', 'conversation', 'order', 'booking', 'delivery']).optional(),
    subjectId: objectId.optional(),
    disputeId: objectId.optional()
  }).superRefine((body, context) => {
    if (body.purpose === 'report' && (!body.subjectType || !body.subjectId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['subjectId'], message: 'A report subject is required' });
    if (body.purpose === 'dispute' && !body.disputeId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['disputeId'], message: 'A dispute is required' });
    if (body.purpose === 'message' && (body.subjectType !== 'conversation' || !body.subjectId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['subjectId'], message: 'A conversation is required for message media' });
    if (body.purpose === 'verification' && (body.subjectType !== 'business' || !body.subjectId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['subjectId'], message: 'A business is required for verification evidence' });
    if (body.purpose === 'delivery' && (body.subjectType !== 'delivery' || !body.subjectId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['subjectId'], message: 'A delivery is required for delivery evidence' });
  }),
  params: z.record(z.never()).default({}),
  query: z.record(z.never()).default({})
});

const completeSchema = z.object({
  body: z.object({ publicId: z.string().trim().min(1).max(500), originalName: z.string().trim().max(180).regex(/^[^\\/]+$/).optional(), alt: z.string().trim().max(200).optional() }),
  params: z.object({ sessionId: objectId }),
  query: z.record(z.never()).default({})
});

const accessSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ evidenceId: objectId }), query: z.record(z.never()).default({}) });
const policySchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

module.exports = { sessionSchema, completeSchema, accessSchema, policySchema };
