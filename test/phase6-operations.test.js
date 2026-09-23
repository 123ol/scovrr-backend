const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { Job, JOB_STATUSES } = require('../src/jobs/job.model');
const { Payout, PAYOUT_STATUSES } = require('../src/modules/payouts/payout.model');
const { Payment } = require('../src/modules/payments/payment.model');
const { PaymentReconciliation } = require('../src/modules/reconciliation/reconciliation.model');
const { comparePayment } = require('../src/modules/reconciliation/reconciliation.service');
const { PaystackPayoutProvider } = require('../src/integrations/payouts/paystack-payout.provider');
const { ExpoPushProvider } = require('../src/integrations/notifications/expo-push.provider');
const { NotificationDelivery } = require('../src/modules/notifications/notification-delivery.model');
const { MAX_DELIVERY_ATTEMPTS } = require('../src/modules/notifications/notification-delivery.service');

function payment(status = 'successful') {
  return new Payment({ amountMinor: 1250000, currency: 'NGN', status });
}

test('reconciliation compares provider status, amount, and currency without mutating payment state', () => {
  assert.deepEqual(comparePayment(payment(), { status: 'success', amount: 1250000, currency: 'NGN' }), { status: 'matched', mismatchType: null, details: null });
  assert.equal(comparePayment(payment(), { status: 'success', amount: 1250001, currency: 'NGN' }).mismatchType, 'amount_mismatch');
  assert.equal(comparePayment(payment(), { status: 'success', amount: 1250000, currency: 'USD' }).mismatchType, 'currency_mismatch');
  assert.equal(comparePayment(payment('pending'), { status: 'success', amount: 1250000, currency: 'NGN' }).mismatchType, 'internal_settlement_missing');
  assert.equal(comparePayment(payment(), null).mismatchType, 'missing_provider_transaction');
});

test('operational models expose bounded statuses and idempotency indexes', () => {
  assert.ok(JOB_STATUSES.includes('processing'));
  assert.ok(JOB_STATUSES.includes('dead'));
  assert.ok(PAYOUT_STATUSES.includes('processing'));
  assert.ok(PAYOUT_STATUSES.includes('held'));
  assert.ok(Job.schema.indexes().some(([fields]) => fields.idempotencyKey));
  assert.ok(Payout.schema.indexes().some(([fields]) => fields.providerReference));
  assert.ok(NotificationDelivery.schema.path('nextAttemptAt'));
  assert.equal(MAX_DELIVERY_ATTEMPTS, 5);
});

test('reconciliation records can safely represent provider transactions with no internal payment', () => {
  const record = new PaymentReconciliation({ _id: new mongoose.Types.ObjectId(), runId: 'SCV-REC-TEST', provider: 'paystack', providerReference: 'orphan-reference', internalStatus: 'missing', providerStatus: 'successful', status: 'action_required', mismatchType: 'missing_internal_payment', providerAmountMinor: 5000, providerCurrency: 'NGN' });
  const safe = record.toSafeJSON();
  assert.equal(safe.paymentId, null);
  assert.equal(safe.mismatchType, 'missing_internal_payment');
});

test('external payout and push providers fail explicitly when credentials are absent', () => {
  assert.throws(() => new PaystackPayoutProvider('').ensureConfigured(), (error) => error.code === 'PAYOUT_PROVIDER_NOT_CONFIGURED');
  assert.throws(() => new ExpoPushProvider('').ensureConfigured(), (error) => error.code === 'PUSH_PROVIDER_NOT_CONFIGURED');
});
