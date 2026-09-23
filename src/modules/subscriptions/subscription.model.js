const mongoose = require('mongoose');
const { DEFAULT_LEGACY_ENTITLEMENTS } = require('./entitlement-registry');

const SUBSCRIPTION_STATUSES = ['trialing', 'trial', 'active', 'past_due', 'grace_period', 'cancel_at_period_end', 'cancelled', 'expired', 'suspended'];

const subscriptionSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, unique: true, index: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', default: null },
  planVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanVersion', default: null },
  pendingPlanVersionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanVersion', default: null },
  planKey: { type: String, required: true, uppercase: true, trim: true, maxlength: 80, default: 'FREE' },
  status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'active', index: true },
  billingInterval: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: 'NGN' },
  currentPeriodStart: { type: Date, default: null },
  currentPeriodEnd: { type: Date, default: null, index: true },
  trialStart: { type: Date, default: null },
  trialEnd: { type: Date, default: null },
  trialHistory: { type: [{ planId: mongoose.Schema.Types.ObjectId, startedAt: Date, endedAt: Date }], default: [] },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, trim: true, maxlength: 1_000, default: null },
  gracePeriodEndsAt: { type: Date, default: null },
  provider: { type: String, trim: true, maxlength: 80, default: null },
  providerCustomerReference: { type: String, trim: true, maxlength: 200, default: null },
  providerSubscriptionReference: { type: String, trim: true, maxlength: 200, default: null },
  providerAuthorizationReference: { type: String, trim: true, maxlength: 200, default: null },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  entitlementSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Compatibility with the earlier Phase 6 placeholder subscription shape.
  entitlements: { type: mongoose.Schema.Types.Mixed, default: () => ({ ...DEFAULT_LEGACY_ENTITLEMENTS }) }
}, { timestamps: true, versionKey: false, collection: 'subscriptions' });

subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
subscriptionSchema.index({ providerSubscriptionReference: 1 }, { unique: true, sparse: true });

subscriptionSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), businessId: (this.businessId?._id || this.businessId).toString(), planId: (this.planId?._id || this.planId)?.toString() || null, planVersionId: (this.planVersionId?._id || this.planVersionId)?.toString() || null,
    pendingPlanVersionId: (this.pendingPlanVersionId?._id || this.pendingPlanVersionId)?.toString() || null, planKey: this.planKey, status: this.status, billingInterval: this.billingInterval,
    currency: this.currency, currentPeriodStart: this.currentPeriodStart, currentPeriodEnd: this.currentPeriodEnd, trialStart: this.trialStart, trialEnd: this.trialEnd,
    cancelAtPeriodEnd: this.cancelAtPeriodEnd, cancelledAt: this.cancelledAt, cancellationReason: this.cancellationReason, gracePeriodEndsAt: this.gracePeriodEndsAt,
    provider: this.provider, startedAt: this.startedAt, endedAt: this.endedAt, entitlements: this.entitlements || { ...DEFAULT_LEGACY_ENTITLEMENTS }, createdAt: this.createdAt, updatedAt: this.updatedAt
  };
};

const BusinessSubscription = mongoose.models.BusinessSubscription || mongoose.model('BusinessSubscription', subscriptionSchema, 'subscriptions');
const Subscription = BusinessSubscription;

module.exports = { BusinessSubscription, Subscription, SUBSCRIPTION_STATUSES, DEFAULT_ENTITLEMENTS: DEFAULT_LEGACY_ENTITLEMENTS };
