const { AppError } = require('../../common/errors/AppError');
const { SubscriptionPlan } = require('./subscription-plan.model');
const { PlanVersion } = require('./plan-version.model');
const { BusinessSubscription } = require('./subscription.model');
const { EntitlementOverride } = require('./entitlement-override.model');
const { SubscriptionEvent } = require('./subscription-event.model');
const subscriptionService = require('./subscription.service');
const entitlementService = require('./entitlement.service');
const { ENTITLEMENTS, ENTITLEMENT_TYPES, entitlementType } = require('./entitlement-registry');

function validateEntitlementMap(entitlements = {}) {
  for (const [key, value] of Object.entries(entitlements)) {
    if (!Object.values(ENTITLEMENTS).includes(key)) throw new AppError(400, 'INVALID_ENTITLEMENT_KEY', `The entitlement key ${key} is not registered`);
    const type = entitlementType(key);
    if (type === ENTITLEMENT_TYPES.BOOLEAN && typeof value !== 'boolean') throw new AppError(400, 'INVALID_ENTITLEMENT_VALUE', `${key} must be boolean`);
    if (type === ENTITLEMENT_TYPES.INTEGER_LIMIT && value !== null && (!Number.isInteger(value) || value < 0)) throw new AppError(400, 'INVALID_ENTITLEMENT_VALUE', `${key} must be a non-negative integer or null`);
  }
  return entitlements;
}

async function listPlanAdministration() { return subscriptionService.listPlans({ includeDraft: true }); }

async function createPlan(input) {
  const existing = await SubscriptionPlan.findOne({ code: input.code.toUpperCase() });
  if (existing) throw new AppError(409, 'SUBSCRIPTION_PLAN_EXISTS', 'A subscription plan with this code already exists');
  return SubscriptionPlan.create({ ...input, code: input.code.toUpperCase(), status: 'draft', public: input.public !== false });
}

async function createPlanVersion(planId, input) {
  const plan = await SubscriptionPlan.findById(planId);
  if (!plan) throw new AppError(404, 'SUBSCRIPTION_PLAN_NOT_FOUND', 'Subscription plan not found');
  const latest = await PlanVersion.findOne({ planId }).sort({ version: -1 });
  return PlanVersion.create({ planId, version: (latest?.version || 0) + 1, status: 'draft', prices: input.prices, entitlements: validateEntitlementMap(input.entitlements), metadata: input.metadata || {} });
}

async function publishPlanVersion(planVersionId) {
  const version = await PlanVersion.findById(planVersionId);
  if (!version) throw new AppError(404, 'SUBSCRIPTION_PLAN_VERSION_NOT_FOUND', 'Subscription plan version not found');
  if (version.status === 'active') return version;
  if (version.status === 'retired') throw new AppError(409, 'SUBSCRIPTION_PLAN_VERSION_RETIRED', 'A retired plan version cannot be published');
  await PlanVersion.updateMany({ planId: version.planId, status: 'active', _id: { $ne: version._id } }, { $set: { status: 'retired', effectiveTo: new Date() } });
  version.status = 'active'; version.effectiveFrom = new Date(); version.publishedAt = new Date(); await version.save();
  await SubscriptionPlan.updateOne({ _id: version.planId }, { $set: { status: 'active' } });
  return version;
}

async function retirePlanVersion(planVersionId) {
  const version = await PlanVersion.findById(planVersionId);
  if (!version) throw new AppError(404, 'SUBSCRIPTION_PLAN_VERSION_NOT_FOUND', 'Subscription plan version not found');
  version.status = 'retired'; version.effectiveTo = new Date(); await version.save(); return version;
}

async function listSubscriptions({ page = 1, limit = 25, status, planKey } = {}) {
  const filter = { ...(status ? { status } : {}), ...(planKey ? { planKey: planKey.toUpperCase() } : {}) };
  const skip = (page - 1) * limit;
  const [subscriptions, total] = await Promise.all([BusinessSubscription.find(filter).populate('businessId', 'name slug status').populate('planVersionId', 'version prices').sort({ updatedAt: -1 }).skip(skip).limit(limit), BusinessSubscription.countDocuments(filter)]);
  return { subscriptions: subscriptions.map((subscription) => ({ ...subscription.toSafeJSON(), business: subscription.businessId?.name ? { id: subscription.businessId._id.toString(), name: subscription.businessId.name, slug: subscription.businessId.slug, status: subscription.businessId.status } : null, planVersion: subscription.planVersionId?.version ? { id: subscription.planVersionId._id.toString(), version: subscription.planVersionId.version, prices: subscription.planVersionId.prices } : null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function getSubscriptionDetail(businessId) {
  const overview = await subscriptionService.getBusinessOverview(businessId);
  const subscription = await BusinessSubscription.findOne({ businessId });
  const events = subscription ? await SubscriptionEvent.find({ subscriptionId: subscription._id }).sort({ createdAt: -1 }).limit(50) : [];
  return { ...overview, events: events.map((event) => ({ id: event._id.toString(), type: event.type, actorId: event.actorId?.toString() || null, paymentId: event.paymentId?.toString() || null, metadata: event.metadata, createdAt: event.createdAt })) };
}

async function addOverride(actorId, businessId, input) {
  if (!Object.values(ENTITLEMENTS).includes(input.entitlementKey)) throw new AppError(400, 'INVALID_ENTITLEMENT_KEY', 'The entitlement key is not registered');
  validateEntitlementMap({ [input.entitlementKey]: input.value });
  if (input.operation === 'add' && entitlementType(input.entitlementKey) !== ENTITLEMENT_TYPES.INTEGER_LIMIT) throw new AppError(400, 'INVALID_ENTITLEMENT_OPERATION', 'Only integer limit entitlements support additive overrides');
  return EntitlementOverride.create({ businessId, createdByAdminId: actorId, ...input });
}

async function revokeOverride(actorId, overrideId, reason) {
  const override = await EntitlementOverride.findById(overrideId);
  if (!override) throw new AppError(404, 'ENTITLEMENT_OVERRIDE_NOT_FOUND', 'Entitlement override not found');
  override.status = 'revoked'; override.revokedByAdminId = actorId; override.revokedAt = new Date(); override.reason = `${override.reason} Revoked: ${reason}`; await override.save(); return override;
}

async function explainEntitlements(businessId) { return entitlementService.explain(businessId); }

module.exports = { listPlanAdministration, createPlan, createPlanVersion, publishPlanVersion, retirePlanVersion, listSubscriptions, getSubscriptionDetail, addOverride, revokeOverride, explainEntitlements };
