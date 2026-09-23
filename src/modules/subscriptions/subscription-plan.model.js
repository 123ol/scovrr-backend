const mongoose = require('mongoose');

const PLAN_STATUSES = ['draft', 'active', 'retired'];

const planSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 50 },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 1_000, default: '' },
  status: { type: String, enum: PLAN_STATUSES, default: 'draft', index: true },
  displayOrder: { type: Number, min: 0, default: 0 },
  public: { type: Boolean, default: true, index: true },
  trialEligible: { type: Boolean, default: false },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

planSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), code: this.code, name: this.name, description: this.description, status: this.status, displayOrder: this.displayOrder, public: this.public, trialEligible: this.trialEligible, metadata: this.metadata, createdAt: this.createdAt, updatedAt: this.updatedAt }; };

const SubscriptionPlan = mongoose.models.SubscriptionPlan || mongoose.model('SubscriptionPlan', planSchema);

module.exports = { SubscriptionPlan, PLAN_STATUSES };
