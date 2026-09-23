const mongoose = require('mongoose');

const PLAN_VERSION_STATUSES = ['draft', 'active', 'retired'];
const BILLING_INTERVALS = ['monthly', 'yearly'];

const priceSchema = new mongoose.Schema({ billingInterval: { type: String, enum: BILLING_INTERVALS, required: true }, amountMinor: { type: Number, required: true, min: 0 }, currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 } }, { _id: false });
const planVersionSchema = new mongoose.Schema({
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true, index: true },
  version: { type: Number, required: true, min: 1 },
  status: { type: String, enum: PLAN_VERSION_STATUSES, default: 'draft', index: true },
  effectiveFrom: { type: Date, default: null },
  effectiveTo: { type: Date, default: null },
  prices: { type: [priceSchema], default: [] },
  entitlements: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  publishedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

planVersionSchema.index({ planId: 1, version: 1 }, { unique: true });
planVersionSchema.index({ planId: 1, status: 1, effectiveFrom: 1 });
planVersionSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), planId: this.planId.toString(), version: this.version, status: this.status, effectiveFrom: this.effectiveFrom, effectiveTo: this.effectiveTo, prices: this.prices, entitlements: this.entitlements, metadata: this.metadata, publishedAt: this.publishedAt, createdAt: this.createdAt, updatedAt: this.updatedAt }; };

const PlanVersion = mongoose.models.PlanVersion || mongoose.model('PlanVersion', planVersionSchema);

module.exports = { PlanVersion, PLAN_VERSION_STATUSES, BILLING_INTERVALS };
