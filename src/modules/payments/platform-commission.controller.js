const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');
const service = require('./platform-commission.service');

function requestAuditMetadata(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null };
}

const get = asyncHandler(async (_req, res) => sendSuccess(res, { commission: await service.getPlatformCommissionPolicy() }));

const update = asyncHandler(async (req, res) => {
  const result = await service.updatePlatformCommissionPolicy({ commissionBps: req.body.commissionBps, updatedBy: req.auth.userId, reason: req.body.reason });
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.PLATFORM_SETTING_CHANGED, targetType: 'platform_setting', reason: req.body.reason, before: { commissionBps: result.before.commissionBps }, after: { commissionBps: result.policy.commissionBps }, metadata: { setting: result.policy.key }, ...requestAuditMetadata(req) });
  return sendSuccess(res, { commission: result.policy });
});

module.exports = { get, update };
