const mongoose = require('mongoose');

const BUSINESS_CAPABILITIES = ['marketplace', 'services'];
const BUSINESS_STATUSES = ['draft', 'pending_review', 'active', 'suspended', 'rejected', 'closed'];
const OPERATING_MODELS = ['physical_store', 'online_only', 'home_based', 'multiple_locations', 'mobile_professional'];
const VERIFICATION_STATUSES = ['not_started', 'draft', 'submitted', 'under_review', 'additional_information_required', 'approved', 'rejected', 'expired'];

const verificationSchema = new mongoose.Schema({
  status: { type: String, enum: VERIFICATION_STATUSES, default: 'not_started' },
  submittedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectionReason: { type: String, trim: true, maxlength: 1_000, default: null },
  adminNotes: { type: String, trim: true, maxlength: 5_000, default: null }
}, { _id: false });

const suspensionSchema = new mongoose.Schema({
  reason: { type: String, trim: true, maxlength: 2_000, default: null },
  suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  suspendedAt: { type: Date, default: null },
  restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  restoredAt: { type: Date, default: null }
}, { _id: false });

const businessSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 2_000, default: '' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  capabilities: { type: [{ type: String, enum: BUSINESS_CAPABILITIES }], required: true, validate: [(values) => values.length > 0, 'At least one business capability is required'] },
  categories: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], default: [] },
  operatingModel: { type: String, enum: OPERATING_MODELS, required: true },
  status: { type: String, enum: BUSINESS_STATUSES, default: 'draft', index: true },
  verification: { type: verificationSchema, default: () => ({}) },
  suspension: { type: suspensionSchema, default: () => ({}) },
  moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'flagged', 'removed'], default: 'pending', index: true },
  ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
  ratingCount: { type: Number, min: 0, default: 0 },
  socialAccounts: {
    whatsapp: { type: String, trim: true, maxlength: 80 },
    instagram: { type: String, trim: true, maxlength: 120 },
    tiktok: { type: String, trim: true, maxlength: 120 },
    website: { type: String, trim: true, maxlength: 500 }
  },
  createdAt: { type: Date },
  updatedAt: { type: Date }
}, { timestamps: true, versionKey: false });

businessSchema.index({ capabilities: 1, status: 1 });
businessSchema.index({ categories: 1, status: 1 });

businessSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    description: this.description,
    capabilities: this.capabilities,
    categories: this.categories,
    operatingModel: this.operatingModel,
    status: this.status,
    moderationStatus: this.moderationStatus,
    ratingAverage: this.ratingAverage,
    ratingCount: this.ratingCount,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

businessSchema.methods.toOwnerJSON = function toOwnerJSON() {
  return {
    ...this.toPublicJSON(),
    ownerId: this.ownerId.toString(),
    verification: this.verification,
    suspension: this.suspension,
    socialAccounts: this.socialAccounts
  };
};

const Business = mongoose.model('Business', businessSchema);

module.exports = { Business, BUSINESS_CAPABILITIES, BUSINESS_STATUSES, OPERATING_MODELS, VERIFICATION_STATUSES };
