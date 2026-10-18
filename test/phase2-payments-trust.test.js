const assert = require('node:assert/strict');
const { test } = require('node:test');

const { PaymentRiskAssessment } = require('../src/modules/payments/payment-risk-assessment.model');
const { scoreRiskSignals } = require('../src/modules/payments/payment-risk.service');
const { initializePayment, retryPayment } = require('../src/modules/payments/payment.service');
const payoutService = require('../src/modules/payouts/payout.service');
const fs = require('node:fs');

test('payment risk assessment is idempotent per payment and exposes review states', () => {
  const definition = PaymentRiskAssessment.schema.indexes().find(([fields]) => fields.paymentId === 1);
  assert.ok(definition);
  assert.equal(definition[1].unique, true);

  const result = scoreRiskSignals({ payment: { amountMinor: 600_000, type: 'promotion' }, customer: { createdAt: new Date() }, recentFailedPayments: 3 });
  assert.equal(result.decision, 'review');
  assert.deepEqual(result.flags, ['high_amount', 'repeated_payment_failures', 'new_account', 'promotion_funding']);
  assert.equal(result.score, 95);
});

test('ordinary payment risk remains non-blocking', () => {
  assert.deepEqual(scoreRiskSignals({ payment: { amountMinor: 20_000, type: 'order' }, customer: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) }, recentFailedPayments: 0 }), { score: 0, flags: [], decision: 'allow' });
});

test('payment retry is an explicit separate operation over the existing payment authority', () => {
  assert.equal(typeof retryPayment, 'function');
  assert.match(retryPayment.toString(), /assertPaymentTargetOwnership\(userId, type, targetId\)/);
  assert.match(retryPayment.toString(), /activePayment/);
  assert.match(retryPayment.toString(), /retry:/);
  assert.match(initializePayment.toString(), /findIdempotentPayment\(userId, idempotencyKey, type, targetId\)/);
});

test('booking payment recovery is wired through the explicit retry route and mobile journey', () => {
  const routes = fs.readFileSync(require.resolve('../src/modules/payments/payment.routes'), 'utf8');
  const bookingsScreen = fs.readFileSync(require.resolve('../../app/app/bookings.jsx'), 'utf8');
  assert.match(routes, /post\('\/bookings\/:bookingId\/retry'/);
  assert.match(bookingsScreen, /`\/payments\/bookings\/\$\{booking\.id\}\/retry`/);
  assert.match(bookingsScreen, /Retry payment/);
});

test('checkout persists an order-only recovery state before provider initialization', () => {
  const checkoutScreen = fs.readFileSync(require.resolve('../../app/app/checkout.jsx'), 'utf8');
  assert.match(checkoutScreen, /const orderRecovery = \{ orderId: order\.id/);
  assert.match(checkoutScreen, /setPayment\(orderRecovery\);\s*\n\s*persistPayment\(orderRecovery\);\s*\n\s*const paymentResponse = await request\(`\/payments\/orders\/\$\{order\.id\}\/initialize`/);
  assert.match(checkoutScreen, /if \(!recoveryKey \|\| !nextPayment\?\.orderId\) return;/);
  assert.match(checkoutScreen, /if \(!payment\?\.id\) return retryPayment\(\);/);
});

test('seller earnings use the existing ledger and payout boundary', () => {
  assert.equal(typeof payoutService.getEarnings, 'function');
  assert.equal(typeof payoutService.getStatement, 'function');
  assert.ok(require('../src/modules/payouts/payout.validation').earningsSchema);
  assert.ok(require('../src/modules/payouts/payout.validation').statementSchema);
});
