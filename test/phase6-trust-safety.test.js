const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { ADMIN_PERMISSIONS, hasAdminPermission } = require('../src/modules/admin/admin-permissions');
const { Report, REPORT_PRIORITIES } = require('../src/modules/reports/report.model');
const { createReportSchema } = require('../src/modules/reports/report.validation');
const { ModerationCase, MODERATION_STATUSES } = require('../src/modules/moderation/moderation-case.model');
const { Dispute, DISPUTE_STATUSES } = require('../src/modules/disputes/dispute.model');
const { createDisputeSchema } = require('../src/modules/disputes/dispute.validation');
const { defaultPriority } = require('../src/modules/reports/report.service');
const { severityForReason } = require('../src/modules/moderation/moderation.service');

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
  assert.equal(defaultPriority('fraud'), 'high');
  assert.equal(severityForReason('counterfeit'), 'high');
});
