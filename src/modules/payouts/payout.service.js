const { AppError } = require('../../common/errors/AppError');
const { Business } = require('../businesses/business.model');
const { Payment } = require('../payments/payment.model');
const { LedgerEntry } = require('./ledger-entry.model');
const { Payout } = require('./payout.model');
const { PayoutProfile } = require('./payout-profile.model');
const { parseRange } = require('../analytics/analytics-range');
const { getPayoutProvider } = require('../../integrations/payouts');
const { recordAudit } = require('../audit/audit.service');
const { logger } = require('../../common/observability/logger');

async function markEligible() {
  await Payout.updateMany({ status: 'pending', eligibleAt: { $lte: new Date() } }, { $set: { status: 'eligible' } });
}

async function listBusinessPayouts(businessId, query) {
  await markEligible();
  const filter = { businessId, ...(query.status ? { status: query.status } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [payouts, total] = await Promise.all([Payout.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Payout.countDocuments(filter)]);
  return { payouts: payouts.map((payout) => payout.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listAdminPayouts(query) {
  await markEligible();
  const filter = query.status ? { status: query.status } : {};
  const skip = (query.page - 1) * query.limit;
  const [payouts, total] = await Promise.all([Payout.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Payout.countDocuments(filter)]);
  return { payouts: payouts.map((payout) => payout.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getPayout(businessId, payoutId) {
  const payout = await Payout.findOne({ _id: payoutId, businessId });
  if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
  return payout;
}

async function getPayoutProfile(businessId) {
  return PayoutProfile.findOne({ businessId });
}

async function getEarnings(businessId, query = {}) {
  const range = parseRange(query);
  const businessFilter = { businessId, accountType: 'business' };
  const periodFilter = { ...businessFilter, createdAt: { $gte: range.from, $lt: range.to } };
  const [periodRows, balanceRows, payoutRows] = await Promise.all([
    LedgerEntry.aggregate([{ $match: periodFilter }, { $group: { _id: { currency: '$currency', type: '$type', direction: '$direction' }, amountMinor: { $sum: '$amountMinor' } } }]),
    LedgerEntry.aggregate([{ $match: businessFilter }, { $group: { _id: { currency: '$currency', type: '$type', direction: '$direction' }, amountMinor: { $sum: '$amountMinor' } } }]),
    Payout.find({ businessId }).sort({ createdAt: -1 }).limit(20)
  ]);
  function summarize(rows) {
    const byCurrency = new Map();
    for (const row of rows) {
      const currency = row._id.currency;
      if (!currency) continue;
      const item = byCurrency.get(currency) || { currency, creditsMinor: 0, debitsMinor: 0, sellerCreditsMinor: 0, sellerDebitsMinor: 0, payoutsMinor: 0, payoutReversalsMinor: 0 };
      const amount = row.amountMinor || 0;
      if (row._id.direction === 'credit') item.creditsMinor += amount;
      if (row._id.direction === 'debit') item.debitsMinor += amount;
      if (row._id.type === 'seller_credit') item.sellerCreditsMinor += amount;
      if (row._id.type === 'seller_debit') item.sellerDebitsMinor += amount;
      if (row._id.type === 'payout' && row._id.direction === 'debit') item.payoutsMinor += amount;
      if (row._id.type === 'payout_reversal' && row._id.direction === 'credit') item.payoutReversalsMinor += amount;
      byCurrency.set(currency, item);
    }
    return [...byCurrency.values()].map((item) => ({ ...item, netEarningsMinor: Math.max(item.sellerCreditsMinor - item.sellerDebitsMinor, 0), availableMinor: Math.max(item.creditsMinor - item.debitsMinor, 0) }));
  }
  const payoutStatusTotals = payoutRows.reduce((result, payout) => { result[payout.status] = (result[payout.status] || 0) + payout.amountMinor; return result; }, {});
  return { range: { from: range.from, to: range.to, label: range.label }, period: summarize(periodRows), balance: summarize(balanceRows), payoutStatusTotals, recentPayouts: payoutRows.map((payout) => payout.toSafeJSON()), asOf: new Date() };
}

async function getStatement(businessId, query = {}) {
  const range = parseRange(query);
  const entries = await LedgerEntry.find({ businessId, accountType: 'business', createdAt: { $gte: range.from, $lt: range.to } }).sort({ createdAt: -1 }).limit(2_000).lean();
  return { range: { from: range.from, to: range.to, label: range.label }, entries: entries.map((entry) => ({ id: entry._id.toString(), date: entry.createdAt, type: entry.type, direction: entry.direction, amountMinor: entry.amountMinor, currency: entry.currency, paymentId: entry.paymentId?.toString() || null, orderId: entry.orderId?.toString() || null, bookingId: entry.bookingId?.toString() || null })) };
}

async function holdPayout(payoutId, reason) {
  const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: { $in: ['pending', 'eligible', 'queued'] } }, { $set: { status: 'held', holdReason: reason, failureReason: reason } }, { new: true });
  if (!payout) throw new AppError(409, 'PAYOUT_NOT_HOLDABLE', 'This payout is not in a holdable state');
  return payout;
}

async function holdPayoutForDispute(payoutId, disputeNumber, reason) {
  const holdReason = `Dispute ${disputeNumber}: ${reason}`;
  const existing = await Payout.findOne({ _id: payoutId, status: 'held', holdReason: { $regex: `^Dispute ${disputeNumber}:` } });
  if (existing) return { payout: existing, state: 'held', alreadyHeld: true };
  const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: { $in: ['pending', 'eligible', 'queued'] } }, { $set: { status: 'held', holdReason, failureReason: holdReason } }, { new: true });
  if (payout) return { payout, state: 'held', alreadyHeld: false };
  const current = await Payout.findById(payoutId);
  if (!current) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'The related payout was not found');
  return { payout: current, state: ['paid', 'processing'].includes(current.status) ? 'recovery_required' : 'not_held', alreadyHeld: false };
}

async function releasePayoutForDispute(payoutId, disputeNumber) {
  const payout = await Payout.findOne({ _id: payoutId, status: 'held', holdReason: { $regex: `^Dispute ${disputeNumber}:` } });
  if (!payout) return Payout.findById(payoutId);
  payout.status = payout.eligibleAt <= new Date() ? 'eligible' : 'pending';
  payout.holdReason = null;
  payout.failureReason = null;
  await payout.save();
  return payout;
}

async function releasePayout(payoutId) {
  const payout = await Payout.findOne({ _id: payoutId, status: 'held' });
  if (!payout) throw new AppError(409, 'PAYOUT_NOT_RELEASABLE', 'This payout is not currently held');
  payout.status = payout.eligibleAt <= new Date() ? 'eligible' : 'pending';
  payout.holdReason = null;
  payout.failureReason = null;
  await payout.save();
  return payout;
}

async function upsertPayoutProfile(businessId, actorId, input) {
  return PayoutProfile.findOneAndUpdate({ businessId }, { $set: { ...input, businessId, updatedBy: actorId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function assertPayoutCanExecute(payout) {
  const business = await Business.findById(payout.businessId).select('status moderationStatus');
  if (!business || business.status !== 'active' || business.moderationStatus !== 'approved') throw new AppError(409, 'PAYOUT_BUSINESS_UNAVAILABLE', 'Payouts cannot be executed for an unavailable business');
  const payment = await Payment.findById(payout.sourcePaymentId).select('status amountMinor currency refundedAmountMinor');
  if (!payment || !['successful', 'partially_refunded'].includes(payment.status) || payment.refundedAmountMinor >= payment.amountMinor) throw new AppError(409, 'PAYOUT_PAYMENT_INELIGIBLE', 'The source payment is not eligible for payout');
  const profile = await PayoutProfile.findOne({ businessId: payout.businessId, provider: payout.provider, status: 'active' });
  if (!profile || !profile.recipientCode) throw new AppError(409, 'PAYOUT_PROFILE_REQUIRED', 'The business does not have an active payout recipient configured');
  if (profile.currency !== payout.currency) throw new AppError(409, 'PAYOUT_CURRENCY_MISMATCH', 'The payout recipient currency does not match the payout');
  return { business, payment, profile };
}

async function executePayout(payoutId) {
  await markEligible();
  const candidate = await Payout.findById(payoutId);
  if (!candidate) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
  if (candidate.status === 'held') throw new AppError(409, 'PAYOUT_HELD', 'This payout is held and cannot be executed');
  if (candidate.status === 'processing') throw new AppError(409, 'PAYOUT_ALREADY_PROCESSING', 'This payout is already being processed');
  if (candidate.status === 'paid') return candidate;
  if (candidate.status !== 'eligible' || candidate.eligibleAt > new Date()) throw new AppError(409, 'PAYOUT_NOT_ELIGIBLE', 'This payout is not eligible for execution');
  const { profile } = await assertPayoutCanExecute(candidate);
  const provider = getPayoutProvider(candidate.provider);
  provider.ensureConfigured?.();
  const payout = await Payout.findOneAndUpdate({ _id: payoutId, status: 'eligible', eligibleAt: { $lte: new Date() } }, { $set: { status: 'processing', idempotencyKey: `payout:${payoutId}`, providerReference: candidate.payoutNumber, lastAttemptAt: new Date(), failureReason: null }, $inc: { attemptCount: 1 } }, { new: true });
  if (!payout) throw new AppError(409, 'PAYOUT_ALREADY_CLAIMED', 'This payout was claimed by another worker');
  try {
    const result = await provider.initiateTransfer({ amountMinor: payout.amountMinor, currency: payout.currency, recipientCode: profile.recipientCode, reference: payout.payoutNumber, reason: `SCOVRR seller payout ${payout.payoutNumber}` });
    payout.providerReference = result.reference || payout.payoutNumber;
    payout.status = 'processing';
    await payout.save();
    return payout;
  } catch (error) {
    payout.status = error.code === 'PAYOUT_PROVIDER_NOT_CONFIGURED' ? 'eligible' : 'failed';
    payout.failureReason = error.message;
    await payout.save();
    throw error;
  }
}

function canRetryPayout(payout) {
  return payout?.status === 'failed' && !payout.providerReference;
}

async function retryPayout(payoutId) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
  if (!canRetryPayout(payout)) {
    throw new AppError(409, 'PAYOUT_NOT_RETRYABLE', 'Only failed payouts without a provider transfer reference can be retried');
  }
  payout.status = payout.eligibleAt <= new Date() ? 'eligible' : 'pending';
  payout.failureReason = null;
  payout.lastAttemptAt = null;
  await payout.save();
  return payout;
}

async function recordPayoutLedger(payout) {
  return LedgerEntry.findOneAndUpdate({ idempotencyKey: `payout:${payout._id}:business` }, { $setOnInsert: { idempotencyKey: `payout:${payout._id}:business`, accountType: 'business', accountId: payout.businessId, businessId: payout.businessId, paymentId: payout.sourcePaymentId, type: 'payout', direction: 'debit', amountMinor: payout.amountMinor, currency: payout.currency, metadata: { payoutNumber: payout.payoutNumber, providerReference: payout.providerReference } } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function markPayoutPaid(payout) {
  if (payout.status === 'paid') return payout;
  await recordPayoutLedger(payout);
  const updated = await Payout.findOneAndUpdate({ _id: payout._id, status: { $ne: 'paid' } }, { $set: { status: 'paid', paidAt: new Date(), failureReason: null } }, { new: true });
  if (updated) {
    try { await recordAudit({ actorType: 'system', action: 'PAYOUT_PAID', targetType: 'payout', targetId: updated._id, businessId: updated.businessId, after: updated.toSafeJSON() }); } catch (error) { logger.error('payout.audit.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
  }
  return updated || Payout.findById(payout._id);
}

async function verifyPayout(payoutId) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Payout not found');
  if (payout.status === 'paid') return payout;
  if (!['processing', 'failed'].includes(payout.status) || !payout.providerReference) throw new AppError(409, 'PAYOUT_NOT_VERIFYABLE', 'This payout does not have a provider transfer to verify');
  const provider = getPayoutProvider(payout.provider);
  const result = await provider.verifyTransfer(payout.providerReference);
  if (Number(result.amount) !== payout.amountMinor || result.currency !== payout.currency) {
    payout.status = 'held';
    payout.holdReason = 'Provider transfer amount or currency mismatch';
    await payout.save();
    throw new AppError(409, 'PAYOUT_PROVIDER_AMOUNT_MISMATCH', 'The provider transfer does not match the SCOVRR payout');
  }
  if (result.status === 'success') return markPayoutPaid(payout);
  if (result.status === 'reversed') payout.status = 'reversed';
  else if (result.status === 'failed') payout.status = 'failed';
  else payout.status = 'processing';
  payout.failureReason = ['failed', 'reversed'].includes(result.status) ? `Provider transfer status: ${result.status}` : null;
  await payout.save();
  return payout;
}

async function runEligiblePayouts({ limit = 25 } = {}) {
  await markEligible();
  const payouts = await Payout.find({ status: 'eligible', eligibleAt: { $lte: new Date() } }).sort({ eligibleAt: 1 }).limit(limit);
  const results = [];
  for (const payout of payouts) {
    try { results.push(await executePayout(payout._id)); } catch (error) { results.push({ id: payout._id.toString(), status: 'skipped', code: error.code || 'PAYOUT_EXECUTION_FAILED', message: error.message }); }
  }
  return results;
}

module.exports = { markEligible, listBusinessPayouts, listAdminPayouts, getPayout, getPayoutProfile, getEarnings, getStatement, upsertPayoutProfile, holdPayout, holdPayoutForDispute, releasePayout, releasePayoutForDispute, executePayout, retryPayout, canRetryPayout, verifyPayout, markPayoutPaid, runEligiblePayouts, assertPayoutCanExecute };
