const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./promotion.service');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');

const list = asyncHandler(async (req, res) => sendSuccess(res, { promotions: await service.listBusinessPromotions(req.business._id, req.query.status) }));
const create = asyncHandler(async (req, res) => { const promotion = await service.createPromotion(req.business._id, req.auth.userId, req.body); await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.DISCOUNT_CREATED, targetType: 'promotion', targetId: promotion._id, metadata: { businessId: req.business._id.toString(), discountType: promotion.discountType } }); return res.status(201).json({ success: true, data: { promotion: promotion.toSafeJSON() } }); });
const update = asyncHandler(async (req, res) => { const promotion = await service.updatePromotion(req.business._id, req.params.promotionId, req.body, req.auth.userId); const action = req.body.status === 'paused' ? AUDIT_ACTIONS.DISCOUNT_PAUSED : req.body.status === 'archived' ? AUDIT_ACTIONS.DISCOUNT_ARCHIVED : AUDIT_ACTIONS.DISCOUNT_UPDATED; await recordAudit({ actorId: req.auth.userId, action, targetType: 'promotion', targetId: promotion._id, metadata: { businessId: req.business._id.toString(), changedFields: Object.keys(req.body) } }); return sendSuccess(res, { promotion: promotion.toSafeJSON() }); });
const disableCoupon = asyncHandler(async (req, res) => { const coupon = await service.disableCoupon(req.business._id, req.params.promotionId, req.body.code, req.auth.userId); await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.COUPON_DISABLED, targetType: 'coupon_code', targetId: coupon._id, metadata: { businessId: req.business._id.toString() } }); return sendSuccess(res, { coupon: coupon.toSafeJSON() }); });

module.exports = { list, create, update, disableCoupon };
