const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./promotion.admin.service');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listAdminDiscounts(req.query)));
const disable = asyncHandler(async (req, res) => { const result = await service.disableAdminDiscount(req.params.discountId, req.auth.userId, req.body.reason); await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.DISCOUNT_ARCHIVED, targetType: 'promotion', targetId: result.discount._id, reason: req.body.reason, after: result.discount.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { discount: result.discount.toSafeJSON() }); });
module.exports = { list, disable };
