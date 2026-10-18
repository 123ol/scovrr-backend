const mongoose = require('mongoose');

const BUSINESS_CAPABILITIES = ['marketplace', 'services'];
const BUSINESS_STATUSES = ['draft', 'pending_review', 'active', 'suspended', 'rejected', 'closed'];
const OPERATING_MODELS = ['physical_store', 'online_only', 'home_based', 'multiple_locations', 'mobile_professional'];
const VERIFICATION_STATUSES = ['not_started', 'draft', 'submitted', 'under_review', 'additional_information_required', 'approved', 'rejected', 'expired'];
const VERIFICATION_LEVELS = ['basic', 'verified', 'enhanced'];
const STOREFRONT_LAYOUTS = ['standard', 'catalogue_first', 'services_first'];
const STOREFRONT_STATUSES = ['open', 'closed', 'temporarily_closed', 'by_appointment'];

const verificationSchema = new mongoose.Schema({
  status: { type: String, enum: VERIFICATION_STATUSES, default: 'not_started' },
  level: { type: String, enum: VERIFICATION_LEVELS, default: 'basic' },
  submittedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectionReason: { type: String, trim: true, maxlength: 1_000, default: null },
  adminNotes: { type: String, trim: true, maxlength: 5_000, default: null },
  evidenceAssetIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'EvidenceAsset' }], default: [] }
}, { _id: false });

const suspensionSchema = new mongoose.Schema({
  reason: { type: String, trim: true, maxlength: 2_000, default: null },
  suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  suspendedAt: { type: Date, default: null },
  restoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  restoredAt: { type: Date, default: null }
}, { _id: false });

const storefrontFaqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 180 },
  answer: { type: String, required: true, trim: true, maxlength: 1_000 },
  order: { type: Number, min: 0, default: 0 }
}, { _id: false });

const storefrontSchema = new mongoose.Schema({
  bannerUrl: { type: String, trim: true, maxlength: 2_000, default: '' },
  bannerTitle: { type: String, trim: true, maxlength: 140, default: '' },
  bannerSubtitle: { type: String, trim: true, maxlength: 300, default: '' },
  layout: { type: String, enum: STOREFRONT_LAYOUTS, default: 'standard' },
  status: { type: String, enum: STOREFRONT_STATUSES, default: 'open' },
  statusMessage: { type: String, trim: true, maxlength: 240, default: '' },
  announcementTitle: { type: String, trim: true, maxlength: 140, default: '' },
  announcementBody: { type: String, trim: true, maxlength: 500, default: '' },
  announcementExpiresAt: { type: Date, default: null },
  featuredProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  featuredServiceIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }], default: [] },
  faqs: { type: [storefrontFaqSchema], default: [] },
  policies: {
    delivery: { type: String, trim: true, maxlength: 1_000, default: '' },
    returns: { type: String, trim: true, maxlength: 1_000, default: '' },
    cancellations: { type: String, trim: true, maxlength: 1_000, default: '' }
  }
}, { _id: false });

const messagingSchema = new mongoose.Schema({
  greetingEnabled: { type: Boolean, default: false },
  greetingText: { type: String, trim: true, maxlength: 500, default: '' },
  quickReplyTemplates: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] }
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
  storefront: { type: storefrontSchema, default: () => ({}) },
  messaging: { type: messagingSchema, default: () => ({}) },
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
businessSchema.index({ status: 1, moderationStatus: 1, createdAt: -1 });

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
    verificationLevel: this.verification?.status === 'approved' ? (this.verification.level || 'verified') : null,
    verifiedBadge: this.verification?.status === 'approved',
    storefront: this.storefront ? {
      bannerUrl: this.storefront.bannerUrl || '',
      bannerTitle: this.storefront.bannerTitle || '',
      bannerSubtitle: this.storefront.bannerSubtitle || '',
      layout: this.storefront.layout || 'standard',
      status: this.storefront.status || 'open',
      statusMessage: this.storefront.statusMessage || '',
      announcementTitle: this.storefront.announcementTitle || '',
      announcementBody: this.storefront.announcementBody || '',
      announcementExpiresAt: this.storefront.announcementExpiresAt || null,
      featuredProductIds: (this.storefront.featuredProductIds || []).map((id) => id.toString()),
      featuredServiceIds: (this.storefront.featuredServiceIds || []).map((id) => id.toString()),
      faqs: (this.storefront.faqs || []).map((faq) => ({ question: faq.question, answer: faq.answer, order: faq.order })),
      policies: {
        delivery: this.storefront.policies?.delivery || '',
        returns: this.storefront.policies?.returns || '',
        cancellations: this.storefront.policies?.cancellations || ''
      }
    } : null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

businessSchema.methods.toOwnerJSON = function toOwnerJSON() {
  return {
    ...this.toPublicJSON(),
    ownerId: this.ownerId.toString(),
    verification: {
      ...(this.verification?.toObject?.() || this.verification || {}),
      evidenceAssetIds: (this.verification?.evidenceAssetIds || []).map((id) => id.toString())
    },
    suspension: this.suspension,
    socialAccounts: this.socialAccounts,
    messaging: {
      greetingEnabled: Boolean(this.messaging?.greetingEnabled),
      greetingText: this.messaging?.greetingText || '',
      quickReplyTemplates: (this.messaging?.quickReplyTemplates || []).map((value) => value.toString())
    }
  };
};

const Business = mongoose.model('Business', businessSchema);

module.exports = { Business, BUSINESS_CAPABILITIES, BUSINESS_STATUSES, OPERATING_MODELS, VERIFICATION_STATUSES, VERIFICATION_LEVELS, STOREFRONT_LAYOUTS, STOREFRONT_STATUSES };
