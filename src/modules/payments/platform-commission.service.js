const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { PlatformCommission } = require('./platform-commission.model');

const PLATFORM_COMMISSION_KEY = 'platform_commission_bps';

function normalizeCommissionBps(value) {
  const bps = Number(value);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new AppError(400, 'INVALID_PLATFORM_COMMISSION', 'Commission must be a whole-number basis-point value between 0 and 10000');
  }
  return bps;
}

async function getPlatformCommissionPolicy() {
  const configured = await PlatformCommission.findOne({ key: PLATFORM_COMMISSION_KEY });
  if (!configured) {
    return {
      key: PLATFORM_COMMISSION_KEY,
      commissionBps: normalizeCommissionBps(env.platformCommissionBps),
      commissionPercent: Number((normalizeCommissionBps(env.platformCommissionBps) / 100).toFixed(2)),
      source: 'environment',
      updatedAt: null,
      updatedBy: null
    };
  }
  return configured.toSafeJSON('database');
}

async function updatePlatformCommissionPolicy({ commissionBps, updatedBy, reason }) {
  const nextBps = normalizeCommissionBps(commissionBps);
  const current = await PlatformCommission.findOne({ key: PLATFORM_COMMISSION_KEY });
  const before = current ? current.toSafeJSON('database') : await getPlatformCommissionPolicy();
  const policy = await PlatformCommission.findOneAndUpdate(
    { key: PLATFORM_COMMISSION_KEY },
    { $set: { commissionBps: nextBps, updatedBy, reason: reason || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return { before, policy: policy.toSafeJSON('database') };
}

function calculateCommissionMinor(amountMinor, commissionBps) {
  const amount = Number(amountMinor);
  const bps = normalizeCommissionBps(commissionBps);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new AppError(400, 'INVALID_PAYMENT_AMOUNT', 'Payment amount must be a non-negative whole number');
  return Math.min(Math.max(amount - 1, 0), Math.floor(amount * bps / 10_000));
}

module.exports = { PLATFORM_COMMISSION_KEY, normalizeCommissionBps, getPlatformCommissionPolicy, updatePlatformCommissionPolicy, calculateCommissionMinor };
