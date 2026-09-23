const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./subscription.admin.service');
const { recordAudit } = require('../audit/audit.service');

const audit = (req, action, targetType, targetId, reason, after) => recordAudit({ actorId: req.auth.userId, action, targetType, targetId, reason, after, ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
const plans = asyncHandler(async (_req, res) => sendSuccess(res, { plans: await service.listPlanAdministration() }));
const createPlan = asyncHandler(async (req, res) => { const plan = await service.createPlan(req.body); await audit(req, 'PLAN_CREATED', 'subscription_plan', plan._id, 'Subscription plan created', plan.toSafeJSON()); return res.status(201).json({ success: true, data: { plan: plan.toSafeJSON() } }); });
const createVersion = asyncHandler(async (req, res) => { const version = await service.createPlanVersion(req.params.planId, req.body); await audit(req, 'PLAN_VERSION_CREATED', 'plan_version', version._id, 'Subscription plan version created', version.toSafeJSON()); return res.status(201).json({ success: true, data: { version: version.toSafeJSON() } }); });
const publishVersion = asyncHandler(async (req, res) => { const version = await service.publishPlanVersion(req.params.planVersionId); await audit(req, 'PLAN_VERSION_PUBLISHED', 'plan_version', version._id, 'Subscription plan version published', version.toSafeJSON()); return sendSuccess(res, { version: version.toSafeJSON() }); });
const retireVersion = asyncHandler(async (req, res) => { const version = await service.retirePlanVersion(req.params.planVersionId); await audit(req, 'PLAN_RETIRED', 'plan_version', version._id, 'Subscription plan version retired', version.toSafeJSON()); return sendSuccess(res, { version: version.toSafeJSON() }); });
const subscriptions = asyncHandler(async (req, res) => sendSuccess(res, await service.listSubscriptions(req.query)));
const detail = asyncHandler(async (req, res) => sendSuccess(res, await service.getSubscriptionDetail(req.params.businessId)));
const explain = asyncHandler(async (req, res) => sendSuccess(res, { entitlements: await service.explainEntitlements(req.params.businessId) }));
const addOverride = asyncHandler(async (req, res) => { const override = await service.addOverride(req.auth.userId, req.params.businessId, req.body); await audit(req, 'SUBSCRIPTION_OVERRIDE_ADDED', 'entitlement_override', override._id, req.body.reason, override.toSafeJSON()); return res.status(201).json({ success: true, data: { override: override.toSafeJSON() } }); });
const revokeOverride = asyncHandler(async (req, res) => { const override = await service.revokeOverride(req.auth.userId, req.params.overrideId, req.body.reason); await audit(req, 'SUBSCRIPTION_OVERRIDE_REMOVED', 'entitlement_override', override._id, req.body.reason, override.toSafeJSON()); return sendSuccess(res, { override: override.toSafeJSON() }); });

module.exports = { plans, createPlan, createVersion, publishVersion, retireVersion, subscriptions, detail, explain, addOverride, revokeOverride };
