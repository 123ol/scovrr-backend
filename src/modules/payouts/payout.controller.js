const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./payout.service');
const { recordAudit } = require('../audit/audit.service');

const listBusiness = asyncHandler(async (req, res) => sendSuccess(res, await service.listBusinessPayouts(req.business._id, req.query)));
const listAdmin = asyncHandler(async (req, res) => sendSuccess(res, await service.listAdminPayouts(req.query)));
const getProfile = asyncHandler(async (req, res) => sendSuccess(res, { profile: (await service.getPayoutProfile(req.business._id))?.toSafeJSON() || null }));
const earnings = asyncHandler(async (req, res) => sendSuccess(res, await service.getEarnings(req.business._id, req.query)));
const statement = asyncHandler(async (req, res) => {
  const result = await service.getStatement(req.business._id, req.query);
  if (req.query.format === 'csv') {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [['Date', 'Type', 'Direction', 'Amount minor', 'Currency', 'Payment ID', 'Order ID', 'Booking ID'], ...result.entries.map((entry) => [entry.date?.toISOString?.() || entry.date, entry.type, entry.direction, entry.amountMinor, entry.currency, entry.paymentId, entry.orderId, entry.bookingId])];
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="scovrr-earnings-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(lines.map((line) => line.map(escape).join(',')).join('\n'));
  }
  return sendSuccess(res, result);
});
const execute = asyncHandler(async (req, res) => { const payout = await service.executePayout(req.params.payoutId); await recordAudit({ actorId: req.auth.userId, action: 'PAYOUT_EXECUTION_REQUESTED', targetType: 'payout', targetId: payout._id, reason: req.body.reason, after: payout.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { payout: payout.toSafeJSON() }); });
const retry = asyncHandler(async (req, res) => { const payout = await service.retryPayout(req.params.payoutId); await recordAudit({ actorId: req.auth.userId, action: 'PAYOUT_RETRY_REQUESTED', targetType: 'payout', targetId: payout._id, reason: req.body.reason, after: payout.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { payout: payout.toSafeJSON() }); });
const verify = asyncHandler(async (req, res) => { const payout = await service.verifyPayout(req.params.payoutId); await recordAudit({ actorId: req.auth.userId, action: 'PAYOUT_MANUALLY_RESOLVED', targetType: 'payout', targetId: payout._id, reason: req.body.reason, after: payout.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { payout: payout.toSafeJSON() }); });
const hold = asyncHandler(async (req, res) => { const payout = await service.holdPayout(req.params.payoutId, req.body.reason); await recordAudit({ actorId: req.auth.userId, action: 'PAYOUT_HELD', targetType: 'payout', targetId: payout._id, reason: req.body.reason, after: payout.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { payout: payout.toSafeJSON() }); });
const release = asyncHandler(async (req, res) => { const payout = await service.releasePayout(req.params.payoutId); await recordAudit({ actorId: req.auth.userId, action: 'PAYOUT_RELEASED', targetType: 'payout', targetId: payout._id, reason: req.body.reason, after: payout.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { payout: payout.toSafeJSON() }); });
const setProfile = asyncHandler(async (req, res) => { const profile = await service.upsertPayoutProfile(req.params.businessId, req.auth.userId, req.body); await recordAudit({ actorId: req.auth.userId, action: 'payout.profile_updated', targetType: 'payout_profile', targetId: profile._id, metadata: { businessId: req.params.businessId }, after: profile.toSafeJSON(), ipAddress: req.ip }); return sendSuccess(res, { profile: profile.toSafeJSON() }); });

module.exports = { listBusiness, listAdmin, getProfile, earnings, statement, execute, retry, verify, hold, release, setProfile };
