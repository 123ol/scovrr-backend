const { AppError } = require('../../common/errors/AppError');
const { env } = require('../../config/env');
const { BusinessSubscription } = require('./subscription.model');
const { SubscriptionPlan } = require('./subscription-plan.model');
const { PlanVersion } = require('./plan-version.model');
const { EntitlementOverride } = require('./entitlement-override.model');
const { DEFAULT_LEGACY_ENTITLEMENTS, INITIAL_PLAN_ENTITLEMENTS, ENTITLEMENTS, normalizeEntitlements, legacyEntitlementsFromMap } = require('./entitlement-registry');
const usageService = require('./subscription-usage.service');

function addPeriod(start, interval) {
  const end = new Date(start);
  const originalDay = end.getUTCDate();
  const originalMonth = end.getUTCMonth();
  const originalYear = end.getUTCFullYear();
  const targetMonth = interval === 'yearly' ? originalMonth : originalMonth + 1;
  const targetYear = interval === 'yearly' ? originalYear + 1 : originalYear + Math.floor(targetMonth / 12);
  const normalizedMonth = interval === 'yearly' ? targetMonth : targetMonth % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  end.setUTCFullYear(targetYear, normalizedMonth, Math.min(originalDay, lastDay));
  return end;
}

function freeFallbackMap() { return { ...INITIAL_PLAN_ENTITLEMENTS.FREE }; }

async function findPlanVersion(code = 'FREE') {
  const plan = await SubscriptionPlan.findOne({ code: String(code).toUpperCase(), status: 'active' });
  if (!plan) return null;
  return PlanVersion.findOne({ planId: plan._id, status: 'active', $or: [{ effectiveFrom: null }, { effectiveFrom: { $lte: new Date() } }], $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $gt: new Date() } }] }] }).sort({ version: -1 });
}

async function assertFreePlanConfigured() {
  const freeVersion = await findPlanVersion('FREE');
  if (!freeVersion && env.nodeEnv === 'production') {
    throw new AppError(503, 'SUBSCRIPTION_PLANS_NOT_CONFIGURED', 'Subscription plans are not configured for this environment');
  }
  return freeVersion;
}

async function getOrCreateBusinessSubscription(businessId) {
  let subscription = await BusinessSubscription.findOne({ businessId });
  if (subscription) return subscription;

  const freeVersion = await assertFreePlanConfigured();
  const entitlementMap = freeVersion?.entitlements || freeFallbackMap();
  try {
    return await BusinessSubscription.create({
      businessId,
      planId: freeVersion?.planId || null,
      planVersionId: freeVersion?._id || null,
      planKey: 'FREE',
      status: 'active',
      billingInterval: 'monthly',
      currency: 'NGN',
      entitlementSnapshot: entitlementMap,
      entitlements: legacyEntitlementsFromMap(entitlementMap)
    });
  } catch (error) {
    if (error?.code === 11000) return BusinessSubscription.findOne({ businessId });
    throw error;
  }
}

function resolveSubscriptionState(subscription, now = new Date()) {
  const status = subscription.status;
  if (['cancelled', 'expired', 'suspended'].includes(status)) return { active: false, grace: false, status, fallback: true };
  if (subscription.trialEnd && subscription.trialEnd <= now && ['trial', 'trialing'].includes(status)) return { active: false, grace: false, status: 'expired', fallback: true };
  if (subscription.currentPeriodEnd && subscription.currentPeriodEnd <= now) {
    if (subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt > now) return { active: true, grace: true, status: 'grace_period', fallback: false };
    return { active: false, grace: false, status: 'expired', fallback: true };
  }
  if (status === 'past_due') return { active: Boolean(subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt > now), grace: true, status, fallback: !(subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt > now) };
  return { active: true, grace: false, status, fallback: false };
}

async function getEffectiveEntitlements(businessId, options = {}) {
  const now = options.now || new Date();
  const subscription = options.subscription || await getOrCreateBusinessSubscription(businessId);
  const state = resolveSubscriptionState(subscription, now);
  let planVersion = null;
  if (!state.fallback && subscription.planVersionId) planVersion = await PlanVersion.findById(subscription.planVersionId);
  if (!planVersion && !state.fallback && subscription.planKey) planVersion = await findPlanVersion(subscription.planKey);
  if (!planVersion) planVersion = await findPlanVersion('FREE');
  const registryDefaults = INITIAL_PLAN_ENTITLEMENTS[subscription.planKey] || INITIAL_PLAN_ENTITLEMENTS.FREE;
  const configuredMap = planVersion?.entitlements || subscription.entitlementSnapshot || {};
  // New entitlement keys must default from the registry when an older persisted plan snapshot predates them.
  const baseMap = { ...registryDefaults, ...configuredMap };
  const effective = { ...baseMap };
  const overrides = await EntitlementOverride.find({ businessId, status: 'active', startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }).sort({ createdAt: 1 });
  const appliedOverrides = [];
  for (const override of overrides) {
    const current = effective[override.entitlementKey];
    if (override.operation === 'add' && typeof current === 'number' && typeof override.value === 'number') effective[override.entitlementKey] = current + override.value;
    else effective[override.entitlementKey] = override.value;
    appliedOverrides.push(override.toSafeJSON());
  }
  const normalized = normalizeEntitlements(effective);
  const usage = await usageService.getUsage(businessId, now);
  const legacy = legacyEntitlementsFromMap(effective);
  return {
    businessId: businessId.toString(), subscription, plan: planVersion ? { id: planVersion.planId.toString(), versionId: planVersion._id.toString(), code: subscription.planKey, version: planVersion.version, prices: planVersion.prices } : { id: null, versionId: null, code: 'FREE', version: null, prices: [] },
    status: state.status,
    gracePeriod: state.grace,
    effective: normalized,
    legacy,
    usage,
    overrides: appliedOverrides,
    asOf: now
  };
}

function entitlementRecord(effective, key) {
  return effective.effective[key] || { type: key.endsWith('.max') ? 'integer_limit' : 'boolean', value: false, unlimited: false };
}

async function hasFeature(businessId, key) {
  const effective = await getEffectiveEntitlements(businessId);
  return Boolean(entitlementRecord(effective, key).value);
}

async function getLimit(businessId, key) {
  const effective = await getEffectiveEntitlements(businessId);
  const record = entitlementRecord(effective, key);
  return { key, value: record.unlimited ? null : record.value, unlimited: Boolean(record.unlimited), usage: effective.usage[key] || 0, status: effective.status };
}

async function assertFeature(businessId, key) {
  const effective = await getEffectiveEntitlements(businessId);
  const record = entitlementRecord(effective, key);
  if (!record.value) throw new AppError(403, 'FEATURE_NOT_INCLUDED', 'This capability is not included in the current business plan', { entitlement: key, upgradeRequired: true, subscriptionStatus: effective.status });
  return effective;
}

async function assertWithinLimit(businessId, key, increment = 1) {
  const effective = await getEffectiveEntitlements(businessId);
  const record = entitlementRecord(effective, key);
  if (record.type !== 'integer_limit') return assertFeature(businessId, key);
  if (record.unlimited || record.value === null) return effective;
  const usage = effective.usage[key] || 0;
  if (usage + increment > record.value) throw new AppError(409, 'PLAN_LIMIT_REACHED', 'This business has reached the limit included in its current plan', { entitlement: key, limit: record.value, usage, requested: increment, upgradeRequired: true, subscriptionStatus: effective.status });
  return effective;
}

async function explain(businessId) {
  const effective = await getEffectiveEntitlements(businessId);
  return Object.fromEntries(Object.entries(effective.effective).map(([key, record]) => [key, { ...record, usage: effective.usage[key] || 0, overrides: effective.overrides.filter((override) => override.entitlementKey === key) }]));
}

module.exports = { addPeriod, findPlanVersion, assertFreePlanConfigured, getOrCreateBusinessSubscription, resolveSubscriptionState, getEffectiveEntitlements, hasFeature, getLimit, assertFeature, assertWithinLimit, explain, ENTITLEMENTS, DEFAULT_LEGACY_ENTITLEMENTS };
