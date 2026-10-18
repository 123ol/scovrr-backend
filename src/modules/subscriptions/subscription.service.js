const crypto = require('node:crypto');
const { AppError } = require('../../common/errors/AppError');
const { Business } = require('../businesses/business.model');
const { BusinessSubscription } = require('./subscription.model');
const { SubscriptionPlan } = require('./subscription-plan.model');
const { PlanVersion } = require('./plan-version.model');
const { SubscriptionInvoice } = require('./subscription-invoice.model');
const { SubscriptionBillingAttempt } = require('./subscription-billing-attempt.model');
const { SubscriptionEvent } = require('./subscription-event.model');
const entitlementService = require('./entitlement.service');
const { env } = require('../../config/env');
const { INITIAL_PLAN_ENTITLEMENTS, legacyEntitlementsFromMap } = require('./entitlement-registry');
const { logger } = require('../../common/observability/logger');

function invoiceNumber() { return `SCV-INV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
async function getOrCreateBusinessSubscription(businessId) { return entitlementService.getOrCreateBusinessSubscription(businessId); }
async function getEntitlements(businessId) { return (await entitlementService.getEffectiveEntitlements(businessId)).subscription; }

async function listPlans({ includeDraft = false } = {}) {
  const plans = await SubscriptionPlan.find({ public: true, ...(includeDraft ? {} : { status: 'active' }) }).sort({ displayOrder: 1, code: 1 });
  const result = [];
  for (const plan of plans) {
    const versions = await PlanVersion.find({ planId: plan._id, ...(includeDraft ? {} : { status: 'active' }) }).sort({ version: -1 });
    result.push({ plan: plan.toSafeJSON(), versions: versions.map((version) => version.toSafeJSON()) });
  }
  return result;
}

async function getBusinessOverview(businessId) {
  const effective = await entitlementService.getEffectiveEntitlements(businessId);
  const invoices = await SubscriptionInvoice.find({ businessId }).sort({ createdAt: -1 }).limit(25);
  return { subscription: effective.subscription.toSafeJSON(), renewal: renewalState(effective.subscription, effective.asOf), plan: effective.plan, status: effective.status, gracePeriod: effective.gracePeriod, entitlements: effective.effective, legacyEntitlements: effective.legacy, usage: effective.usage, overrides: effective.overrides, invoices: invoices.map((invoice) => invoice.toSafeJSON()), asOf: effective.asOf };
}

async function resolvePlanVersion({ planVersionId, planCode, billingInterval = 'monthly' }) {
  const version = planVersionId
    ? await PlanVersion.findById(planVersionId).populate('planId')
    : await (async () => {
      const plan = await SubscriptionPlan.findOne({ code: String(planCode || '').toUpperCase(), status: 'active' });
      if (!plan) return null;
      return PlanVersion.findOne({ planId: plan._id, status: 'active' }).sort({ version: -1 }).populate('planId');
    })();
  if (!version || version.status !== 'active' || version.planId?.status !== 'active') throw new AppError(404, 'SUBSCRIPTION_PLAN_VERSION_NOT_FOUND', 'The selected subscription plan is unavailable');
  const price = version.prices.find((item) => item.billingInterval === billingInterval);
  if (!price) throw new AppError(409, 'SUBSCRIPTION_BILLING_INTERVAL_UNAVAILABLE', 'This plan does not support the selected billing interval');
  return { version, price };
}

async function prepareCheckout(businessId, input) {
  const business = await Business.findById(businessId).select('status');
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  if (business.status === 'suspended') throw new AppError(409, 'BUSINESS_SUSPENDED', 'A suspended business cannot change its subscription');
  const subscription = await getOrCreateBusinessSubscription(businessId);
  const { version, price } = await resolvePlanVersion(input);
  if (price.amountMinor < 1) throw new AppError(400, 'FREE_PLAN_PAYMENT_NOT_REQUIRED', 'The Free plan does not require payment');
  if (subscription.planVersionId?.toString() === version._id.toString() && subscription.status === 'active' && subscription.billingInterval === input.billingInterval) throw new AppError(409, 'SUBSCRIPTION_ALREADY_ACTIVE', 'This business already has the selected plan and billing interval');
  return { business, subscription, version, price };
}

async function prepareRecoveryCheckout(businessId) {
  const subscription = await getOrCreateBusinessSubscription(businessId);
  if (!['past_due', 'grace_period'].includes(subscription.status)) throw new AppError(409, 'SUBSCRIPTION_RECOVERY_NOT_REQUIRED', 'This subscription does not currently need payment recovery');
  if (!subscription.planVersionId) throw new AppError(409, 'SUBSCRIPTION_RECOVERY_CONTEXT_MISSING', 'The subscription does not have a recoverable paid plan');
  const version = await PlanVersion.findById(subscription.planVersionId).populate('planId');
  if (!version || !version.planId || version.planId.status !== 'active') throw new AppError(409, 'SUBSCRIPTION_RECOVERY_PLAN_UNAVAILABLE', 'The previous subscription plan is no longer available for recovery');
  const price = version.prices.find((item) => item.billingInterval === subscription.billingInterval) || version.prices.find((item) => item.billingInterval === 'monthly');
  if (!price || price.amountMinor < 1) throw new AppError(409, 'SUBSCRIPTION_RECOVERY_PRICE_UNAVAILABLE', 'The previous subscription price is unavailable for recovery');
  return { subscription, version, price };
}

function recoveryIdempotencyKey(businessId, subscriptionId) {
  return `subscription-recovery:${businessId}:${subscriptionId}`;
}

async function createInvoiceForCheckout({ businessId, subscription, version, price, idempotencyKey }) {
  const periodStart = new Date();
  const periodEnd = entitlementService.addPeriod(periodStart, price.billingInterval);
  const existing = idempotencyKey ? await SubscriptionInvoice.findOne({ idempotencyKey }) : null;
  if (existing) return existing;
  try {
    return await SubscriptionInvoice.create({ businessId, subscriptionId: subscription._id, planVersionId: version._id, invoiceNumber: invoiceNumber(), idempotencyKey, periodStart, periodEnd, subtotalMinor: price.amountMinor, totalMinor: price.amountMinor, currency: price.currency, status: 'open', dueAt: periodStart, metadata: { planCode: version.planId?.code || null, planVersion: version.version, billingInterval: price.billingInterval } });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) return SubscriptionInvoice.findOne({ idempotencyKey });
    throw error;
  }
}

async function createBillingAttempt({ subscription, invoice, amountMinor, currency, idempotencyKey }) {
  const existing = await SubscriptionBillingAttempt.findOne({ idempotencyKey });
  if (existing) return existing;
  const count = await SubscriptionBillingAttempt.countDocuments({ invoiceId: invoice._id });
  try {
    return await SubscriptionBillingAttempt.create({ subscriptionId: subscription._id, invoiceId: invoice._id, attemptNumber: count + 1, idempotencyKey, amountMinor, currency });
  } catch (error) {
    if (error?.code === 11000) return SubscriptionBillingAttempt.findOne({ idempotencyKey });
    throw error;
  }
}

async function recordEvent(subscription, type, metadata = {}, actorId = null, paymentId = null) {
  return SubscriptionEvent.create({ subscriptionId: subscription._id, businessId: subscription.businessId, type, actorId, paymentId, metadata });
}

async function activateFromPayment(payment, providerData = {}) {
  const planVersionId = payment.metadata?.planVersionId;
  const invoiceId = payment.metadata?.invoiceId;
  const subscription = await BusinessSubscription.findOne({ _id: payment.subscriptionId, businessId: payment.businessId });
  const version = planVersionId ? await PlanVersion.findById(planVersionId).populate('planId') : null;
  const invoice = invoiceId ? await SubscriptionInvoice.findById(invoiceId) : null;
  if (!subscription || !version || !invoice) throw new AppError(409, 'SUBSCRIPTION_PAYMENT_CONTEXT_INVALID', 'The subscription payment is missing a valid billing context');
  if (invoice.status === 'paid' && subscription.planVersionId?.toString() === version._id.toString()) return subscription;
  const subscriptionEventName = subscription.planKey === 'FREE' ? 'SUBSCRIPTION_STARTED' : 'SUBSCRIPTION_RENEWED';
  subscription.planId = version.planId?._id || version.planId;
  subscription.planVersionId = version._id;
  subscription.pendingPlanVersionId = null;
  subscription.planKey = version.planId?.code || subscription.planKey;
  subscription.status = 'active';
  subscription.billingInterval = invoice.metadata?.billingInterval || subscription.billingInterval;
  subscription.currency = invoice.currency;
  subscription.currentPeriodStart = invoice.periodStart || new Date();
  subscription.currentPeriodEnd = invoice.periodEnd;
  subscription.cancelAtPeriodEnd = false;
  subscription.cancelledAt = null;
  subscription.cancellationReason = null;
  subscription.gracePeriodEndsAt = null;
  subscription.provider = payment.provider;
  subscription.providerAuthorizationReference = providerData.authorization?.authorization_code || subscription.providerAuthorizationReference;
  subscription.entitlementSnapshot = version.entitlements;
  subscription.entitlements = legacyEntitlementsFromMap(version.entitlements);
  await subscription.save();
  invoice.status = 'paid'; invoice.paidAt = new Date(); invoice.paymentId = payment._id; await invoice.save();
  await SubscriptionBillingAttempt.updateMany({ invoiceId: invoice._id, status: { $in: ['initialized', 'pending'] } }, { $set: { status: 'successful', providerReference: payment.providerReference || payment.reference, completedAt: new Date() } });
  await require('../analytics/domain-event.service').queue(subscriptionEventName, { actorType: 'system', businessId: subscription.businessId, entityType: 'business', entityId: subscription.businessId, metadata: { subscriptionId: subscription._id.toString(), paymentId: payment._id.toString(), planKey: subscription.planKey, amountMinor: invoice.totalMinor, currency: invoice.currency } }, `subscription:${subscription._id}:${invoice._id}:${subscriptionEventName.toLowerCase()}`);
  await recordEvent(subscription, 'SUBSCRIPTION_ACTIVATED', { planVersionId: version._id.toString(), invoiceId: invoice._id.toString(), amountMinor: invoice.totalMinor }, null, payment._id);
  return subscription;
}

async function scheduleDowngrade(businessId, input) {
  const subscription = await getOrCreateBusinessSubscription(businessId);
  const { version, price } = await resolvePlanVersion(input);
  if (price.amountMinor > 0) throw new AppError(409, 'SUBSCRIPTION_CHANGE_PAYMENT_REQUIRED', 'A paid plan change requires a verified payment');
  subscription.pendingPlanVersionId = version._id;
  subscription.cancelAtPeriodEnd = false;
  await subscription.save();
  await recordEvent(subscription, 'PLAN_CHANGE_SCHEDULED', { pendingPlanVersionId: version._id.toString(), billingInterval: price.billingInterval });
  return subscription;
}

async function cancelAtPeriodEnd(businessId, reason = 'Cancelled by business owner') {
  const subscription = await getOrCreateBusinessSubscription(businessId);
  if (!subscription.currentPeriodEnd || subscription.planKey === 'FREE') throw new AppError(409, 'FREE_SUBSCRIPTION_NOT_CANCELLABLE', 'The Free plan does not require cancellation');
  subscription.cancelAtPeriodEnd = true;
  subscription.status = 'cancel_at_period_end';
  subscription.cancellationReason = reason;
  subscription.cancelledAt = new Date();
  await subscription.save();
  await require('../analytics/domain-event.service').queue('SUBSCRIPTION_CANCELLED', { actorType: 'user', businessId: subscription.businessId, entityType: 'business', entityId: subscription.businessId, metadata: { subscriptionId: subscription._id.toString(), reason } }, `subscription:${subscription._id}:cancelled:${subscription.cancelledAt.toISOString()}`);
  await recordEvent(subscription, 'CANCEL_SCHEDULED', { reason });
  return subscription;
}

function renewalState(subscription, now = new Date()) {
  if (!subscription || subscription.planKey === 'FREE') return { state: 'not_applicable', canResume: false, automaticCharge: 'provider_dependent', providerConfigured: false, periodEnd: null };
  const periodOpen = Boolean(subscription.currentPeriodEnd && subscription.currentPeriodEnd > now);
  return {
    state: subscription.cancelAtPeriodEnd ? 'cancel_at_period_end' : 'scheduled',
    canResume: Boolean(subscription.cancelAtPeriodEnd && periodOpen && ['active', 'cancel_at_period_end'].includes(subscription.status)),
    automaticCharge: 'provider_dependent',
    providerConfigured: Boolean(subscription.providerSubscriptionReference),
    periodEnd: subscription.currentPeriodEnd || null
  };
}

async function resumeAtPeriodEnd(businessId) {
  const subscription = await getOrCreateBusinessSubscription(businessId);
  const renewal = renewalState(subscription);
  if (!subscription.cancelAtPeriodEnd) return subscription;
  if (!renewal.canResume) throw new AppError(409, 'SUBSCRIPTION_RENEWAL_WINDOW_CLOSED', 'This subscription can no longer resume renewal for the current period');
  subscription.cancelAtPeriodEnd = false;
  subscription.status = 'active';
  subscription.cancelledAt = null;
  subscription.cancellationReason = null;
  await subscription.save();
  await require('../analytics/domain-event.service').queue('SUBSCRIPTION_RENEWAL_RESUMED', { actorType: 'user', businessId: subscription.businessId, entityType: 'business', entityId: subscription.businessId, metadata: { subscriptionId: subscription._id.toString(), periodEnd: subscription.currentPeriodEnd } }, `subscription:${subscription._id}:renewal-resumed:${subscription.currentPeriodEnd?.toISOString() || 'none'}`);
  await recordEvent(subscription, 'RENEWAL_RESUMED', { periodEnd: subscription.currentPeriodEnd });
  return subscription;
}

async function notifySubscriptionOwner(subscription, type, title, body, data = {}) {
  try {
    const business = await Business.findById(subscription.businessId).select('ownerId');
    if (!business?.ownerId) return;
    const { createNotification } = require('../notifications/notification.service');
    await createNotification({ deduplicationKey: `subscription:${subscription._id}:${type}:${subscription.gracePeriodEndsAt?.getTime() || 'now'}`, userId: business.ownerId, type, title, body, data: { subscriptionId: subscription._id.toString(), businessId: subscription.businessId.toString(), ...data } });
  } catch (error) {
    logger.error('subscription.notification.failed', { error: { name: error.name, code: error.code, message: error.message } });
  }
}

async function transitionToFree(subscription, reason, now = new Date()) {
  const freeVersion = await entitlementService.assertFreePlanConfigured();
  const previousPlan = subscription.planKey;
  const entitlementMap = freeVersion?.entitlements || { ...INITIAL_PLAN_ENTITLEMENTS.FREE };
  subscription.planId = freeVersion?.planId || null;
  subscription.planVersionId = freeVersion?._id || null;
  subscription.pendingPlanVersionId = null;
  subscription.planKey = 'FREE';
  subscription.status = 'active';
  subscription.billingInterval = 'monthly';
  subscription.currentPeriodStart = now;
  subscription.currentPeriodEnd = null;
  subscription.cancelAtPeriodEnd = false;
  subscription.cancelledAt = null;
  subscription.cancellationReason = null;
  subscription.gracePeriodEndsAt = null;
  subscription.endedAt = null;
  subscription.entitlementSnapshot = entitlementMap;
  subscription.entitlements = legacyEntitlementsFromMap(entitlementMap);
  await subscription.save();
  if (previousPlan !== 'FREE') await require('../analytics/domain-event.service').queue('SUBSCRIPTION_EXPIRED', { actorType: 'system', businessId: subscription.businessId, entityType: 'business', entityId: subscription.businessId, metadata: { subscriptionId: subscription._id.toString(), planKey: previousPlan, reason } }, `subscription:${subscription._id}:expired:${now.toISOString()}`);
  await SubscriptionInvoice.updateMany({ subscriptionId: subscription._id, status: { $in: ['open', 'failed'] }, dueAt: { $lte: now } }, { $set: { status: 'void' } });
  await recordEvent(subscription, 'SUBSCRIPTION_MOVED_TO_FREE', { previousPlan, reason });
  await notifySubscriptionOwner(subscription, 'subscription_downgraded', 'Your SCOVRR plan is now Free', 'Your paid subscription period has ended. Your business data is safe and your Free plan limits now apply.', { previousPlan, reason });
  return subscription;
}

async function markPastDue(subscription, reason, now = new Date()) {
  const gracePeriodEndsAt = new Date(now.getTime() + env.subscriptionGracePeriodDays * 24 * 60 * 60 * 1_000);
  subscription.status = 'past_due';
  subscription.gracePeriodEndsAt = gracePeriodEndsAt;
  subscription.cancelAtPeriodEnd = false;
  await subscription.save();
  await recordEvent(subscription, 'SUBSCRIPTION_GRACE_STARTED', { reason, gracePeriodEndsAt });
  await notifySubscriptionOwner(subscription, 'subscription_past_due', 'Subscription payment required', `Your plan needs attention. Paid access remains available until ${gracePeriodEndsAt.toISOString()}.`, { reason, gracePeriodEndsAt });
  return subscription;
}

async function processSubscriptionLifecycle({ now = new Date(), limit = 100 } = {}) {
  const subscriptions = await BusinessSubscription.find({
    status: { $in: ['trialing', 'trial', 'active', 'past_due', 'grace_period', 'cancel_at_period_end'] },
    $or: [
      { trialEnd: { $ne: null, $lte: now } },
      { currentPeriodEnd: { $ne: null, $lte: now } },
      { gracePeriodEndsAt: { $ne: null, $lte: now } }
    ]
  }).sort({ currentPeriodEnd: 1, updatedAt: 1 }).limit(limit);
  const report = { scanned: subscriptions.length, graceStarted: 0, movedToFree: 0, unchanged: 0, errors: 0 };
  for (const subscription of subscriptions) {
    try {
      if (subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt <= now) {
        await transitionToFree(subscription, 'grace_period_expired', now);
        report.movedToFree += 1;
        continue;
      }
      if (subscription.trialEnd && subscription.trialEnd <= now && ['trial', 'trialing'].includes(subscription.status)) {
        await markPastDue(subscription, 'trial_ended_without_verified_payment', now);
        report.graceStarted += 1;
        continue;
      }
      if (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now) {
        report.unchanged += 1;
        continue;
      }
      const pendingVersion = subscription.pendingPlanVersionId ? await PlanVersion.findById(subscription.pendingPlanVersionId).populate('planId') : null;
      const pendingIsFree = pendingVersion?.planId?.code === 'FREE' || pendingVersion?.prices?.every((price) => price.amountMinor === 0);
      if (subscription.cancelAtPeriodEnd || pendingIsFree) {
        await transitionToFree(subscription, subscription.cancelAtPeriodEnd ? 'cancelled_at_period_end' : 'scheduled_free_plan', now);
        report.movedToFree += 1;
        continue;
      }
      if (subscription.status === 'past_due' && subscription.gracePeriodEndsAt && subscription.gracePeriodEndsAt > now) {
        report.unchanged += 1;
        continue;
      }
      await markPastDue(subscription, 'period_ended_without_verified_renewal', now);
      report.graceStarted += 1;
    } catch (error) {
      report.errors += 1;
      logger.error('subscription.lifecycle.failed', { subscriptionId: subscription._id.toString(), error: { name: error.name, code: error.code, message: error.message } });
    }
  }
  return report;
}

async function listInvoices(businessId, { page = 1, limit = 25 } = {}) {
  const skip = (page - 1) * limit;
  const [invoices, total] = await Promise.all([SubscriptionInvoice.find({ businessId }).sort({ createdAt: -1 }).skip(skip).limit(limit), SubscriptionInvoice.countDocuments({ businessId })]);
  return { invoices: invoices.map((invoice) => invoice.toSafeJSON()), total, page, limit, pages: Math.ceil(total / limit) };
}

module.exports = { invoiceNumber, getOrCreateBusinessSubscription, getEntitlements, listPlans, getBusinessOverview, resolvePlanVersion, prepareCheckout, prepareRecoveryCheckout, recoveryIdempotencyKey, createInvoiceForCheckout, createBillingAttempt, activateFromPayment, scheduleDowngrade, cancelAtPeriodEnd, renewalState, resumeAtPeriodEnd, transitionToFree, markPastDue, processSubscriptionLifecycle, listInvoices, recordEvent };
