const assert = require('node:assert/strict');
const test = require('node:test');
const { isAddressInDeliveryZones, buildProofSnapshot } = require('../src/modules/deliveries/delivery.service');
const { businessDeliveryGetSchema, businessDeliverySchema } = require('../src/modules/deliveries/delivery.validation');
const { sessionSchema } = require('../src/modules/evidence/evidence.validation');
const { EVIDENCE_PURPOSES } = require('../src/modules/evidence/evidence-asset.model');
const mongoose = require('mongoose');
const { Job, JOB_STATUSES } = require('../src/jobs/job.model');
const { Payout, PAYOUT_STATUSES } = require('../src/modules/payouts/payout.model');
const { Payment } = require('../src/modules/payments/payment.model');
const { PaymentReconciliation } = require('../src/modules/reconciliation/reconciliation.model');
const { comparePayment } = require('../src/modules/reconciliation/reconciliation.service');
const { PaystackPayoutProvider } = require('../src/integrations/payouts/paystack-payout.provider');
const { ExpoPushProvider } = require('../src/integrations/notifications/expo-push.provider');
const { NotificationDelivery } = require('../src/modules/notifications/notification-delivery.model');
const { MAX_DELIVERY_ATTEMPTS, deliveryFailureState, pushErrorCode, notificationContinuationIdempotencyKey, PERMANENT_PUSH_ERRORS } = require('../src/modules/notifications/notification-delivery.service');
const { canRetryPayout } = require('../src/modules/payouts/payout.service');
const { safeJobError } = require('../src/jobs/job.service');
const { singleFlight } = require('../src/jobs/job-runner');

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

test('job failure persistence redacts credentials and stays bounded', () => {
  const message = safeJobError({ message: `provider failed token=secret-value password:another-secret ${'x'.repeat(2_000)}` });
  assert.match(message, /token=\[REDACTED\]/);
  assert.match(message, /password:\[REDACTED\]/);
  assert.ok(message.length <= 1_000);
  assert.equal(Job.schema.path('lastError').options.maxlength, 1_000);
});

test('background job scheduler prevents overlapping runs in one process', async () => {
  let executions = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = singleFlight(async () => {
    executions += 1;
    await gate;
    return executions;
  });

  const first = run();
  const second = run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first, second);
  assert.equal(executions, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
  assert.equal(await run(), 2);
});

test('push delivery failures have bounded retry and terminal states', () => {
  const now = Date.UTC(2030, 0, 1);
  const retry = deliveryFailureState(1, 'MessageRateExceeded', now);
  assert.equal(retry.status, 'failed');
  assert.equal(retry.nextAttemptAt.getTime(), now + 1_000);
  assert.equal(deliveryFailureState(MAX_DELIVERY_ATTEMPTS, 'MessageRateExceeded', now).status, 'dead');
  assert.equal(deliveryFailureState(1, 'MessageTooBig', now).status, 'dead');
  assert.equal(pushErrorCode({ details: { error: 'DeviceNotRegistered' } }), 'DeviceNotRegistered');
  assert.equal(pushErrorCode({ code: 'PUSH_PROVIDER_ERROR' }), 'PUSH_PROVIDER_ERROR');
  assert.ok(PERMANENT_PUSH_ERRORS.has('DeviceNotRegistered'));
});

test('push continuation jobs use unique scheduled idempotency keys for repeated retries', () => {
  const first = new Date(Date.UTC(2030, 0, 1, 12, 0, 1));
  const second = new Date(Date.UTC(2030, 0, 1, 12, 0, 2));
  assert.notEqual(notificationContinuationIdempotencyKey('notification-1', first), notificationContinuationIdempotencyKey('notification-1', second));
});

test('payout retry is limited to failed attempts without provider references', () => {
  assert.equal(canRetryPayout({ status: 'failed', providerReference: null }), true);
  assert.equal(canRetryPayout({ status: 'failed', providerReference: 'TRF-1' }), false);
  assert.equal(canRetryPayout({ status: 'eligible', providerReference: null }), false);
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
test('optional seller delivery zones match state-wide and city-specific Nigerian coverage', () => {
  assert.equal(isAddressInDeliveryZones({ state: 'Ondo', city: 'Akure' }, []), true);
  assert.equal(isAddressInDeliveryZones({ state: 'Ondo', city: 'Akure' }, [{ state: 'ondo', cities: [] }]), true);
  assert.equal(isAddressInDeliveryZones({ state: 'Ondo', city: 'Akure' }, [{ state: 'Ondo', cities: ['Akure', 'Owo'] }]), true);
  assert.equal(isAddressInDeliveryZones({ state: 'Ondo', city: 'Ibadan' }, [{ state: 'Ondo', cities: ['Akure'] }]), false);
});
test('business delivery reads use the existing branch-scoped route contract', () => {
  const result = businessDeliveryGetSchema.safeParse({ body: {}, params: { businessId: '507f1f77bcf86cd799439011', deliveryId: '507f1f77bcf86cd799439012' }, query: {} });
  assert.equal(result.success, true);
  const failed = businessDeliverySchema.safeParse({ body: { action: 'failed' }, params: { businessId: '507f1f77bcf86cd799439011', deliveryId: '507f1f77bcf86cd799439012' }, query: {} });
  assert.equal(failed.success, true);
  const scheduled = businessDeliverySchema.safeParse({ body: { action: 'schedule_pickup', estimatedPickupAt: '2030-01-01T10:00:00.000Z' }, params: { businessId: '507f1f77bcf86cd799439011', deliveryId: '507f1f77bcf86cd799439012' }, query: {} });
  assert.equal(scheduled.success, true);
});

test('delivery proof and pickup verification use bounded seller-side contracts', () => {
  const businessId = '507f1f77bcf86cd799439011';
  const deliveryId = '507f1f77bcf86cd799439012';
  const proof = businessDeliverySchema.safeParse({ body: { action: 'delivered', proof: { note: 'Left with the customer', evidenceAssetIds: [deliveryId] } }, params: { businessId, deliveryId }, query: {} });
  assert.equal(proof.success, true);
  const threePhotos = businessDeliverySchema.safeParse({ body: { action: 'delivered', proof: { evidenceAssetIds: [deliveryId, businessId, deliveryId] } }, params: { businessId, deliveryId }, query: {} });
  assert.equal(threePhotos.success, true);
  const tooManyPhotos = businessDeliverySchema.safeParse({ body: { action: 'delivered', proof: { evidenceAssetIds: [deliveryId, businessId, deliveryId, businessId] } }, params: { businessId, deliveryId }, query: {} });
  assert.equal(tooManyPhotos.success, false);
  assert.equal(businessDeliverySchema.safeParse({ body: { action: 'pickup', pickupCode: '12345' }, params: { businessId, deliveryId }, query: {} }).success, false);
  assert.equal(sessionSchema.safeParse({ body: { purpose: 'delivery', mimeType: 'image/jpeg', subjectType: 'delivery', subjectId: deliveryId }, params: {}, query: {} }).success, true);
  assert.equal(sessionSchema.safeParse({ body: { purpose: 'delivery', mimeType: 'image/jpeg', subjectType: 'order', subjectId: deliveryId }, params: {}, query: {} }).success, false);
  assert.ok(EVIDENCE_PURPOSES.includes('delivery'));
});

test('delivery proof snapshots retain the recording actor and timestamp without leaking upload ids', () => {
  const recordedAt = new Date('2026-10-18T12:00:00.000Z');
  const snapshot = buildProofSnapshot({ note: 'Left with the customer', evidenceAssetIds: ['untrusted-upload-id'] }, [{ evidenceId: '507f1f77bcf86cd799439011', visibility: 'parties' }], '507f1f77bcf86cd799439012', recordedAt);
  assert.equal(snapshot.note, 'Left with the customer');
  assert.equal(snapshot.recordedBy, '507f1f77bcf86cd799439012');
  assert.equal(snapshot.recordedAt, recordedAt);
  assert.deepEqual(snapshot.evidence, [{ evidenceId: '507f1f77bcf86cd799439011', visibility: 'parties' }]);
  assert.equal(Object.hasOwn(snapshot, 'evidenceAssetIds'), false);
});
