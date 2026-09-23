const crypto = require('node:crypto');
const { AppError } = require('../../common/errors/AppError');
const { Payment } = require('../payments/payment.model');
const { PaymentEvent } = require('../payments/payment-event.model');
const { PaymentReconciliation } = require('./reconciliation.model');
const { recordAudit } = require('../audit/audit.service');
const { getPaymentProvider } = require('../../integrations/payments');
const { PromotionFunding } = require('../advertising/promotion-funding.model');

function reconciliationRunId() {
  return `SCV-REC-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function normalizeProviderStatus(status) {
  if (status === 'success') return 'successful';
  return status || null;
}

function comparePayment(payment, providerData) {
  if (!providerData) return { status: 'action_required', mismatchType: 'missing_provider_transaction', details: 'The provider did not return a transaction for this reference.' };
  const providerStatus = normalizeProviderStatus(providerData.status);
  if (Number(providerData.amount) !== payment.amountMinor) return { status: 'action_required', mismatchType: 'amount_mismatch', details: 'The provider amount does not match the SCOVRR payment.' };
  if (providerData.currency && providerData.currency !== payment.currency) return { status: 'action_required', mismatchType: 'currency_mismatch', details: 'The provider currency does not match the SCOVRR payment.' };
  const settledInternally = ['successful', 'partially_refunded', 'refunded'].includes(payment.status);
  // A newly constructed successful Payment can represent a legacy fixture/document
  // that predates settlement tracking. Persisted successful payments are still
  // flagged unless their settlement has explicitly completed.
  if (payment.status === 'successful' && payment.settlementStatus !== 'completed' && !(payment.isNew && payment.settlementStatus === 'pending')) return { status: 'action_required', mismatchType: 'internal_settlement_missing', details: `The provider is successful but SCOVRR settlement is ${payment.settlementStatus || 'incomplete'}.` };
  if (settledInternally && providerStatus !== 'successful') return { status: 'mismatch', mismatchType: 'provider_status_mismatch', details: `SCOVRR is ${payment.status} but the provider is ${providerStatus || 'unknown'}.` };
  if (payment.status === 'pending' && providerStatus === 'successful') return { status: 'action_required', mismatchType: 'internal_settlement_missing', details: 'The provider is successful but SCOVRR has not settled the payment.' };
  if (!settledInternally && payment.status !== providerStatus) return { status: 'mismatch', mismatchType: 'provider_status_mismatch', details: `SCOVRR is ${payment.status} but the provider is ${providerStatus || 'unknown'}.` };
  return { status: 'matched', mismatchType: null, details: null };
}

async function reconcilePayment(payment, provider, runId) {
  const providerReference = payment.providerReference || payment.reference;
  let providerData;
  try { providerData = await provider.verifyTransaction(providerReference); } catch (error) {
    if (error.code === 'PAYMENT_PROVIDER_ERROR' && /not found/i.test(error.message)) providerData = null;
    else throw error;
  }
  let comparison = comparePayment(payment, providerData);
  if (payment.type === 'promotion' && normalizeProviderStatus(providerData?.status) === 'successful') {
    const funding = payment.promotionFundingId ? await PromotionFunding.findById(payment.promotionFundingId).select('status verifiedAt') : null;
    if (!funding || funding.status !== 'verified') comparison = { status: 'action_required', mismatchType: 'internal_settlement_missing', details: 'The provider payment is successful but promotion funding has not been verified; repair the campaign funding context before serving.' };
  }
  return PaymentReconciliation.findOneAndUpdate({ runId, paymentId: payment._id }, { $set: { runId, provider: payment.provider, paymentId: payment._id, providerReference, internalStatus: payment.status, providerStatus: normalizeProviderStatus(providerData?.status), internalAmountMinor: payment.amountMinor, providerAmountMinor: providerData?.amount ?? null, internalCurrency: payment.currency, providerCurrency: providerData?.currency || null, status: comparison.status, mismatchType: comparison.mismatchType, details: comparison.details, providerPayload: null } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function runReconciliation({ provider: providerName = 'paystack', limit = 25 } = {}) {
  const provider = getPaymentProvider(providerName);
  const runId = reconciliationRunId();
  const payments = await Payment.find({ provider: providerName, status: { $in: ['pending', 'successful', 'failed', 'abandoned', 'reversed', 'refunded', 'partially_refunded'] } }).sort({ updatedAt: -1 }).limit(limit);
  const records = [];
  for (const payment of payments) records.push(await reconcilePayment(payment, provider, runId));
  const providerTransactions = await provider.listTransactions({ perPage: limit });
  const knownReferences = new Set(payments.map((payment) => payment.providerReference || payment.reference));
  for (const transaction of providerTransactions || []) {
    if (knownReferences.has(transaction.reference)) continue;
    records.push(await PaymentReconciliation.findOneAndUpdate({ runId, providerReference: transaction.reference }, { $set: { runId, provider: providerName, paymentId: null, providerReference: transaction.reference, internalStatus: 'missing', providerStatus: normalizeProviderStatus(transaction.status), internalAmountMinor: 0, providerAmountMinor: transaction.amount || null, internalCurrency: null, providerCurrency: transaction.currency || null, status: 'action_required', mismatchType: 'missing_internal_payment', details: 'The provider transaction has no matching SCOVRR payment record.' } }, { upsert: true, new: true, setDefaultsOnInsert: true }));
  }
  return { runId, records: records.map((record) => record.toSafeJSON()), matched: records.filter((record) => record.status === 'matched').length, mismatches: records.filter((record) => record.status !== 'matched').length };
}

async function reconcileOnePayment(paymentId) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const provider = getPaymentProvider(payment.provider);
  return (await reconcilePayment(payment, provider, reconciliationRunId())).toSafeJSON();
}

async function listReconciliations(query) {
  const filter = { ...(query.status ? { status: query.status } : {}), ...(query.mismatchType ? { mismatchType: query.mismatchType } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [records, total] = await Promise.all([PaymentReconciliation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), PaymentReconciliation.countDocuments(filter)]);
  return { reconciliations: records.map((record) => record.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function resolveReconciliation(reconciliationId, adminId, input) {
  const record = await PaymentReconciliation.findById(reconciliationId);
  if (!record) throw new AppError(404, 'RECONCILIATION_NOT_FOUND', 'Reconciliation record not found');
  if (record.status === 'matched') throw new AppError(409, 'RECONCILIATION_ALREADY_MATCHED', 'Matched records do not require manual resolution');
  if (['resolved', 'ignored'].includes(record.status)) throw new AppError(409, 'RECONCILIATION_ALREADY_RESOLVED', 'This reconciliation record has already been resolved');
  record.status = input.status;
  record.resolution = input.resolution;
  record.resolvedBy = adminId;
  record.resolvedAt = new Date();
  await record.save();
  return record;
}

async function runScheduledReconciliation() {
  try {
    const result = await runReconciliation({ limit: 25 });
    try { await recordAudit({ actorType: 'system', action: 'RECONCILIATION_RUN', targetType: 'payment_reconciliation_run', metadata: { runId: result.runId, provider: 'paystack', limit: 25, scheduled: true } }); } catch (auditError) { console.error('Unable to record reconciliation audit event:', auditError.message); }
    return result;
  } catch (error) { if (error.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED') return { skipped: true, code: error.code }; throw error; }
}

async function webhookFailureCount(reference) {
  return PaymentEvent.countDocuments({ reference, status: 'failed' });
}

module.exports = { reconciliationRunId, normalizeProviderStatus, comparePayment, reconcilePayment, runReconciliation, reconcileOnePayment, listReconciliations, resolveReconciliation, runScheduledReconciliation, webhookFailureCount };
