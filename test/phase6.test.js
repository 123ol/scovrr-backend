const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { hasAdminPermission, permissionsForAdminRoles } = require('../src/modules/admin/admin-rbac');
const { Report } = require('../src/modules/reports/report.model');
const { Dispute } = require('../src/modules/disputes/dispute.model');
const { Promotion } = require('../src/modules/promotions/promotion.model');
const { Subscription, DEFAULT_ENTITLEMENTS } = require('../src/modules/subscriptions/subscription.model');
const { createReportSchema } = require('../src/modules/reports/report.validation');
const { createDisputeSchema } = require('../src/modules/disputes/dispute.validation');
const { createPromotionSchema } = require('../src/modules/promotions/promotion.validation');
const { normalizeEvent } = require('../src/modules/analytics/analytics.service');
const { getHomeRecommendations } = require('../src/modules/analytics/recommendation.service');

test('admin roles resolve to explicit permissions without losing role compatibility', () => {
  const permissions = permissionsForAdminRoles(['moderation']);
  assert.equal(hasAdminPermission(['moderation'], 'moderation.manage'), true);
  assert.equal(hasAdminPermission(['support'], 'finance'), false);
  assert.ok(permissions.includes('reports.manage'));
});

test('operations models protect private workflow data behind safe serialization', () => {
  const id = new mongoose.Types.ObjectId();
  const report = new Report({ reporterId: id, subjectType: 'product', subjectId: id, reason: 'fraud', details: 'Evidence attached' });
  const dispute = new Dispute({ disputeNumber: 'SCV-DSP-TEST', customerId: id, businessId: id, targetType: 'order', orderId: id, reason: 'item_not_received', description: 'The paid item has not arrived.' });
  const promotion = new Promotion({ businessId: id, createdBy: id, name: 'Launch', valueType: 'percentage', value: 10, startsAt: new Date(), endsAt: new Date(Date.now() + 60_000) });
  const subscription = new Subscription({ businessId: id });
  assert.equal(report.toSafeJSON().reporterId, id.toString());
  assert.equal(dispute.toSafeJSON().orderId, id.toString());
  assert.equal(promotion.toSafeJSON().value, 10);
  assert.equal(subscription.toSafeJSON().entitlements.productLimit, DEFAULT_ENTITLEMENTS.productLimit);
});

test('phase 6 request contracts reject malformed operations and normalize analytics identity', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.equal(createReportSchema.safeParse({ body: { subjectType: 'product', subjectId: id, reason: 'fraud', evidence: [] }, params: {}, query: {} }).success, true);
  assert.equal(createDisputeSchema.safeParse({ body: { targetType: 'order', targetId: id, reason: 'item_not_received', description: 'Too short' , evidence: [] }, params: {}, query: {} }).success, false);
  assert.equal(createPromotionSchema.safeParse({ body: { name: 'Ten off', valueType: 'percentage', value: 10, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 60_000).toISOString() }, params: { businessId: id }, query: {} }).success, true);
  const event = normalizeEvent(null, { eventName: 'product_view', anonymousSessionId: 'session-12345', properties: { source: 'discover' } });
  assert.equal(event.userId, null);
  assert.equal(event.anonymousSessionId, 'session-12345');
  assert.equal(typeof getHomeRecommendations, 'function');
});
