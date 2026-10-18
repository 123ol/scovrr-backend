const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { ADMIN_PERMISSIONS, hasAdminPermission } = require('../src/modules/admin/admin-permissions');
const { Report, REPORT_PRIORITIES } = require('../src/modules/reports/report.model');
const { createReportSchema, adminReportListSchema } = require('../src/modules/reports/report.validation');
const { ModerationCase, MODERATION_STATUSES } = require('../src/modules/moderation/moderation-case.model');
const { ModerationAppeal, MODERATION_APPEAL_STATUSES } = require('../src/modules/moderation/moderation-appeal.model');
const { Dispute, DISPUTE_STATUSES } = require('../src/modules/disputes/dispute.model');
const { createDisputeSchema } = require('../src/modules/disputes/dispute.validation');
const { createSchema: createModerationAppealSchema, decisionSchema: moderationAppealDecisionSchema } = require('../src/modules/moderation/moderation-appeal.validation');
const { escalateReportSchema } = require('../src/modules/reports/report.validation');
const { defaultPriority, priorityRank, summarizeInvestigationReports } = require('../src/modules/reports/report.service');
const { severityForReason, severityRank, isAppealableCase } = require('../src/modules/moderation/moderation.service');
const { getCustomerProtectionPolicy } = require('../src/modules/disputes/dispute.service');

test('trust and safety domains remain separate and bounded', () => {
  const id = new mongoose.Types.ObjectId();
  const report = new Report({ reportNumber: 'SCV-RPT-TEST', reporterId: id, subjectType: 'product', subjectId: id, reason: 'fraud', details: 'Suspicious listing', evidence: [{ url: 'https://cdn.example.test/evidence.jpg', type: 'image' }] });
  const moderationCase = new ModerationCase({ caseNumber: 'SCV-MOD-TEST', subjectType: 'product', subjectId: id, source: 'report', reason: 'fraud' });
  const dispute = new Dispute({ disputeNumber: 'SCV-DSP-TEST-2', customerId: id, businessId: id, targetType: 'order', transactionType: 'order', orderId: id, reason: 'item_not_received', description: 'The paid item was not delivered.', disputedAmountMinor: 5000, currency: 'NGN' });
  assert.equal(report.toSafeJSON().evidence.length, 0);
  assert.equal(report.toSafeJSON({ includeEvidence: true }).evidence.length, 1);
  assert.ok(REPORT_PRIORITIES.includes(report.priority));
  assert.ok(MODERATION_STATUSES.includes(moderationCase.status));
  assert.ok(DISPUTE_STATUSES.includes(dispute.status));
  assert.equal(dispute.toSafeJSON().transactionType, 'order');
});

test('moderation and finance permissions are intentionally split', () => {
  assert.equal(hasAdminPermission(['moderator'], ADMIN_PERMISSIONS.MODERATION_RESOLVE), true);
  assert.equal(hasAdminPermission(['moderator'], ADMIN_PERMISSIONS.REFUNDS_EXECUTE), false);
  assert.equal(hasAdminPermission(['finance_admin'], ADMIN_PERMISSIONS.REFUNDS_EXECUTE), true);
  assert.equal(hasAdminPermission(['finance_admin'], ADMIN_PERMISSIONS.MODERATION_RESOLVE), false);
});

test('report and dispute contracts reject malformed or cross-domain values', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.equal(createReportSchema.safeParse({ body: { subjectType: 'conversation', subjectId: id, reason: 'privacy', evidence: [] }, params: {}, query: {} }).success, true);
  assert.equal(createReportSchema.safeParse({ body: { subjectType: 'product', subjectId: id, reason: 'not-a-reason', evidence: [] }, params: {}, query: {} }).success, false);
  assert.equal(createDisputeSchema.safeParse({ body: { targetType: 'order', targetId: id, reason: 'professional_no_show', description: 'This reason belongs to a booking.', evidence: [] }, params: {}, query: {} }).success, true);
  assert.equal(escalateReportSchema.safeParse({ body: { reason: 'Requires specialist review' }, params: { reportId: id }, query: {} }).success, true);
  assert.equal(createReportSchema.safeParse({ body: { subjectType: 'conversation', subjectId: id, reason: 'support_escalation', details: 'Customer needs support', evidence: [] }, params: {}, query: {} }).success, true);
  assert.equal(createReportSchema.safeParse({ body: { subjectType: 'product', subjectId: id, reason: 'support_escalation', details: 'Customer needs support', evidence: [] }, params: {}, query: {} }).success, false);
  assert.equal(defaultPriority('fraud'), 'high');
  assert.equal(defaultPriority('support_escalation'), 'high');
  assert.ok(priorityRank('critical') > priorityRank('normal'));
  assert.equal(severityForReason('counterfeit'), 'high');
  assert.ok(severityRank('critical') > severityRank('medium'));
});

test('admin report queue can isolate support escalations without widening report access', () => {
  const parsed = adminReportListSchema.safeParse({ body: {}, params: {}, query: { status: 'open', reason: 'support_escalation', page: '1', limit: '25' } });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.query.reason, 'support_escalation');
  assert.equal(adminReportListSchema.safeParse({ body: {}, params: {}, query: { reason: 'unknown_reason', page: '1', limit: '25' } }).success, false);
});

test('moderation appeals reuse closed case decisions and keep their own bounded review contract', () => {
  const id = new mongoose.Types.ObjectId();
  const appeal = new ModerationAppeal({ appealNumber: 'SCV-APL-TEST', moderationCaseId: id, activeCaseKey: id.toString(), appellantId: id, businessId: id, subjectType: 'content_post', subjectId: id, reason: 'The post was removed even though the media and linked service follow the published policy.' });
  assert.equal(appeal.validateSync(), undefined);
  assert.ok(MODERATION_APPEAL_STATUSES.includes(appeal.status));
  assert.equal(appeal.toSafeJSON().activeCaseKey, undefined);
  assert.equal(isAppealableCase({ status: 'removed', decision: { outcome: 'removed' } }), true);
  assert.equal(isAppealableCase({ status: 'approved', decision: { outcome: 'approved' } }), false);
  assert.equal(createModerationAppealSchema.safeParse({ body: { moderationCaseId: id.toString(), reason: 'A sufficiently detailed appeal explanation.' }, params: { businessId: id.toString() }, query: {} }).success, true);
  assert.equal(moderationAppealDecisionSchema.safeParse({ body: { outcome: 'approved', note: 'The content meets the policy after review.' }, params: { appealId: id.toString() }, query: {} }).success, true);
});

test('customer protection policy is a single safe contract for dispute eligibility and outcomes', () => {
  const policy = getCustomerProtectionPolicy();
  assert.ok(policy.windows.orderDisputeDays > 0);
  assert.ok(policy.windows.bookingDisputeDays > 0);
  assert.ok(policy.windows.businessResponseDays > 0);
  assert.deepEqual(policy.eligibility.orderStatuses, ['delivered', 'completed']);
  assert.ok(policy.reasons.order.includes('item_not_received'));
  assert.ok(policy.reasons.booking.includes('service_not_delivered'));
  assert.ok(policy.outcomes.includes('full_refund'));
  assert.match(policy.notes[1], /does not guarantee a refund/);
});

test('abuse investigation summary stays bounded and groups the existing report signals', () => {
  const id = new mongoose.Types.ObjectId();
  const summary = summarizeInvestigationReports([
    { status: 'open', priority: 'critical', reason: 'fraud', reporterId: id },
    { status: 'resolved', priority: 'normal', reason: 'fraud', reporterId: id },
    { status: 'in_review', priority: 'high', reason: 'spam', reporterId: new mongoose.Types.ObjectId() }
  ]);
  assert.deepEqual(summary, {
    total: 3,
    active: 2,
    highPriority: 2,
    uniqueReporters: 2,
    statuses: { open: 1, resolved: 1, in_review: 1 },
    reasons: { fraud: 2, spam: 1 }
  });
});
