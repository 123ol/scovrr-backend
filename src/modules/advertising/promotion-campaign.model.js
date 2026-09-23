const mongoose = require('mongoose');
const { PLACEMENTS, TARGET_TYPES } = require('./promotion-placement');

const CAMPAIGN_STATUSES = ['DRAFT', 'PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EXHAUSTED', 'CANCELLED', 'REJECTED'];
const OBJECTIVES = ['awareness', 'traffic', 'sales', 'bookings', 'followers'];

const targetingSchema = new mongoose.Schema({
  country: { type: String, trim: true, maxlength: 120, default: null },
  state: { type: String, trim: true, maxlength: 120, default: null },
  city: { type: String, trim: true, maxlength: 120, default: null },
  area: { type: String, trim: true, maxlength: 120, default: null },
  radiusKm: { type: Number, min: 1, max: 250, default: null },
  locationIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation' }], default: [] },
  categoryIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], default: [] }
}, { _id: false });

const campaignSchema = new mongoose.Schema({
  campaignNumber: { type: String, required: true, unique: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  targetType: { type: String, enum: TARGET_TYPES, required: true, index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 140 },
  objective: { type: String, enum: OBJECTIVES, required: true, default: 'awareness' },
  status: { type: String, enum: CAMPAIGN_STATUSES, required: true, default: 'DRAFT', index: true },
  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true, index: true },
  timezone: { type: String, trim: true, maxlength: 80, default: 'Africa/Lagos' },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  budgetMinor: { type: Number, required: true, min: 1 },
  dailyBudgetMinor: { type: Number, min: 1, default: null },
  fundedMinor: { type: Number, min: 0, default: 0 },
  spentMinor: { type: Number, min: 0, default: 0 },
  reservedMinor: { type: Number, min: 0, default: 0 },
  refundedMinor: { type: Number, min: 0, default: 0 },
  currentDailyDateKey: { type: String, default: null },
  currentDailySpendMinor: { type: Number, min: 0, default: 0 },
  targeting: { type: targetingSchema, default: () => ({}) },
  placements: { type: [{ type: String, enum: PLACEMENTS }], required: true, validate: [(value) => value.length > 0, 'At least one placement is required'] },
  billingModel: { type: String, enum: ['fixed_placement_budget'], default: 'fixed_placement_budget' },
  moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'flagged', 'removed'], default: 'pending', index: true },
  moderationReason: { type: String, trim: true, maxlength: 1_000, default: null },
  fundedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, versionKey: false });

campaignSchema.index({ status: 1, startAt: 1, endAt: 1, targetType: 1, targetId: 1 });
campaignSchema.index({ businessId: 1, status: 1, createdAt: -1 });
campaignSchema.index({ businessId: 1, fundedAt: -1 });

campaignSchema.methods.remainingMinor = function remainingMinor() {
  return Math.max(this.fundedMinor - this.spentMinor - this.reservedMinor - this.refundedMinor, 0);
};

campaignSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(), campaignNumber: this.campaignNumber, businessId: this.businessId.toString(),
    targetType: this.targetType, targetId: this.targetId.toString(), name: this.name, objective: this.objective,
    status: this.status, startAt: this.startAt, endAt: this.endAt, timezone: this.timezone, currency: this.currency,
    budgetMinor: this.budgetMinor, dailyBudgetMinor: this.dailyBudgetMinor, fundedMinor: this.fundedMinor,
    spentMinor: this.spentMinor, reservedMinor: this.reservedMinor, refundedMinor: this.refundedMinor,
    remainingMinor: this.remainingMinor(), targeting: this.targeting, placements: this.placements,
    billingModel: this.billingModel, moderationStatus: this.moderationStatus, moderationReason: this.moderationReason,
    fundedAt: this.fundedAt, completedAt: this.completedAt, cancelledAt: this.cancelledAt,
    createdAt: this.createdAt, updatedAt: this.updatedAt
  };
};

const PromotionCampaign = mongoose.model('PromotionCampaign', campaignSchema);

module.exports = { PromotionCampaign, CAMPAIGN_STATUSES, OBJECTIVES };
