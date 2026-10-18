const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { addPeriod, resolveSubscriptionState } = require('../src/modules/subscriptions/entitlement.service');
const { recoveryIdempotencyKey, renewalState } = require('../src/modules/subscriptions/subscription.service');
const { recoverySchema, resumeSchema } = require('../src/modules/subscriptions/subscription.validation');
const { ENTITLEMENTS, INITIAL_PLAN_ENTITLEMENTS, legacyEntitlementsFromMap, normalizeEntitlements } = require('../src/modules/subscriptions/entitlement-registry');
const { Subscription } = require('../src/modules/subscriptions/subscription.model');
const { Payment } = require('../src/modules/payments/payment.model');
const { Refund } = require('../src/modules/payments/refund.model');

test('subscription entitlement registry normalizes limits and preserves legacy compatibility', () => {
  const map = INITIAL_PLAN_ENTITLEMENTS.BUSINESS_PLUS;
  const normalized = normalizeEntitlements(map);
  assert.equal(normalized[ENTITLEMENTS.PRODUCTS_MAX].unlimited, true);
  assert.equal(normalized[ENTITLEMENTS.MARKETPLACE_ENABLED].type, 'boolean');
  assert.equal(legacyEntitlementsFromMap(map).productLimit, null);
  assert.equal(legacyEntitlementsFromMap(INITIAL_PLAN_ENTITLEMENTS.FREE).productLimit, 25);
});

test('subscription periods use UTC calendar arithmetic', () => {
  const start = new Date('2026-01-31T12:00:00.000Z');
  assert.equal(addPeriod(start, 'yearly').toISOString(), '2027-01-31T12:00:00.000Z');
  assert.equal(addPeriod(start, 'monthly').toISOString(), '2026-02-28T12:00:00.000Z');
});

test('subscription recovery uses a stable idempotency boundary and strict request contract', () => {
  const businessId = new mongoose.Types.ObjectId().toString();
  const subscriptionId = new mongoose.Types.ObjectId().toString();
  assert.equal(recoveryIdempotencyKey(businessId, subscriptionId), `subscription-recovery:${businessId}:${subscriptionId}`);
  assert.equal(recoverySchema.safeParse({ body: {}, params: { businessId }, query: {} }).success, true);
  assert.equal(recoverySchema.safeParse({ body: { idempotencyKey: 'short' }, params: { businessId }, query: {} }).success, false);
});

test('subscription state distinguishes active, grace, and fallback states', () => {
  const now = new Date('2026-08-20T12:00:00.000Z');
  assert.equal(resolveSubscriptionState({ status: 'active', currentPeriodEnd: new Date('2026-08-21T12:00:00.000Z') }, now).active, true);
  assert.deepEqual(resolveSubscriptionState({ status: 'past_due', currentPeriodEnd: new Date('2026-08-19T12:00:00.000Z'), gracePeriodEndsAt: new Date('2026-08-25T12:00:00.000Z') }, now), { active: true, grace: true, status: 'grace_period', fallback: false });
  assert.equal(resolveSubscriptionState({ status: 'active', currentPeriodEnd: new Date('2026-08-19T12:00:00.000Z'), gracePeriodEndsAt: new Date('2026-08-20T11:59:00.000Z') }, now).fallback, true);
});

test('subscription renewal state supports a reversible cancellation preference without claiming provider auto-charge', () => {
  const periodEnd = new Date('2026-12-31T00:00:00.000Z');
  const subscription = { planKey: 'PRO', status: 'cancel_at_period_end', cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd, providerSubscriptionReference: null };
  assert.deepEqual(renewalState(subscription, new Date('2026-12-01T00:00:00.000Z')), { state: 'cancel_at_period_end', canResume: true, automaticCharge: 'provider_dependent', providerConfigured: false, periodEnd });
  assert.equal(renewalState({ planKey: 'FREE', cancelAtPeriodEnd: false }, new Date()).canResume, false);
  assert.equal(resumeSchema.safeParse({ body: {}, params: { businessId: new mongoose.Types.ObjectId().toString() }, query: {} }).success, true);
});

test('subscription, payment, and refund serializers expose domain references safely', () => {
  const id = new mongoose.Types.ObjectId();
  const subscription = new Subscription({ businessId: id, planKey: 'PRO', status: 'past_due' });
  const payment = new Payment({ reference: 'SCV-PAY-SUB-TEST', type: 'subscription', customerId: id, businessId: id, subscriptionId: id, invoiceId: id, amountMinor: 1500000, currency: 'NGN' });
  const refund = new Refund({ refundNumber: 'SCV-RFD-SUB-TEST', paymentId: id, businessId: id, subscriptionId: id, invoiceId: id, amountMinor: 1500000, currency: 'NGN', reason: 'Subscription access was refunded', requestedBy: id });
  assert.equal(subscription.toSafeJSON().planKey, 'PRO');
  assert.equal(payment.toSafeJSON().type, 'subscription');
  assert.equal(refund.toSafeJSON().subscriptionId, id.toString());
});
