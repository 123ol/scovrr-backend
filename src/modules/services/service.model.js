const mongoose = require('mongoose');
const { publicMedia } = require('../media/catalogue-media.service');

const SERVICE_STATUSES = ['draft', 'pending_review', 'active', 'rejected', 'archived'];
const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'flagged', 'removed'];
const LOCATION_TYPES = ['at_business', 'at_customer', 'online', 'mobile'];
const PAYMENT_RULES = ['full', 'deposit'];

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true, trim: true, maxlength: 2_000 },
  provider: { type: String, trim: true, maxlength: 80 },
  publicId: { type: String, trim: true, maxlength: 300 },
  uploadSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogueUploadSession', default: null },
  mimeType: { type: String, trim: true, maxlength: 100 },
  alt: { type: String, trim: true, maxlength: 200 },
  order: { type: Number, min: 0, default: 0 },
  isCover: { type: Boolean, default: false }
}, { _id: false });

const variantSchema = new mongoose.Schema({
  variantId: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  priceMinor: { type: Number, required: true, min: 1 },
  durationMinutes: { type: Number, required: true, min: 5, max: 1_440 },
  bufferBeforeMinutes: { type: Number, min: 0, max: 240, default: 0 },
  bufferAfterMinutes: { type: Number, min: 0, max: 240, default: 0 },
  media: { type: [mediaSchema], default: [] },
  active: { type: Boolean, default: true }
}, { _id: false });

const staffAssignmentSchema = new mongoose.Schema({
  staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  locationIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation' }], default: [] }
}, { _id: false });

const serviceSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 5_000, default: '' },
  shortDescription: { type: String, trim: true, maxlength: 300, default: '' },
  media: { type: [mediaSchema], default: [] },
  basePriceMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  durationMinutes: { type: Number, required: true, min: 5, max: 1_440 },
  bufferBeforeMinutes: { type: Number, min: 0, max: 240, default: 0 },
  bufferAfterMinutes: { type: Number, min: 0, max: 240, default: 0 },
  locationTypes: { type: [{ type: String, enum: LOCATION_TYPES }], required: true, validate: [(values) => values.length > 0, 'At least one service location type is required'] },
  paymentRule: { type: String, enum: PAYMENT_RULES, default: 'full' },
  depositAmountMinor: { type: Number, min: 0, default: 0 },
  cancellationWindowHours: { type: Number, min: 0, max: 720, default: 24 },
  minNoticeMinutes: { type: Number, min: 0, max: 43_200, default: 60 },
  maxAdvanceDays: { type: Number, min: 1, max: 730, default: 90 },
  locationIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation' }], default: [] },
  staffUserIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
  staffAssignments: { type: [staffAssignmentSchema], default: [] },
  variants: { type: [variantSchema], default: [] },
  status: { type: String, enum: SERVICE_STATUSES, default: 'draft', index: true },
  moderationStatus: { type: String, enum: MODERATION_STATUSES, default: 'pending', index: true },
  publishedAt: { type: Date, default: null },
  rejectionReason: { type: String, trim: true, maxlength: 1_000, default: null },
  ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
  ratingCount: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

serviceSchema.index({ businessId: 1, status: 1, createdAt: -1 });
serviceSchema.index({ categoryId: 1, status: 1 });
serviceSchema.index({ status: 1, moderationStatus: 1, createdAt: -1 });

serviceSchema.methods.toCardJSON = function toCardJSON() {
  const businessId = this.businessId?._id || this.businessId;
  const cover = this.media.find((media) => media.isCover) || this.media[0] || null;
  const activeVariants = this.variants.filter((variant) => variant.active);
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    categoryId: this.categoryId?._id ? this.categoryId._id.toString() : (this.categoryId ? this.categoryId.toString() : null),
    shortDescription: this.shortDescription,
    priceMinor: activeVariants.length > 0 ? Math.min(...activeVariants.map((variant) => variant.priceMinor)) : this.basePriceMinor,
    currency: this.currency,
    durationMinutes: activeVariants.length > 0 ? Math.min(...activeVariants.map((variant) => variant.durationMinutes)) : this.durationMinutes,
    image: cover?.url || null,
    locationTypes: this.locationTypes,
    hasVariants: this.variants.length > 0,
    ratingAverage: this.ratingAverage,
    ratingCount: this.ratingCount,
    status: this.status,
    businessId: businessId.toString()
  };
};

serviceSchema.methods.toOwnerJSON = function toOwnerJSON() {
  const categoryId = this.categoryId?._id || this.categoryId;
  return {
    ...this.toCardJSON(),
    categoryId: categoryId ? categoryId.toString() : null,
    description: this.description,
    media: this.media,
    basePriceMinor: this.basePriceMinor,
    bufferBeforeMinutes: this.bufferBeforeMinutes,
    bufferAfterMinutes: this.bufferAfterMinutes,
    paymentRule: this.paymentRule,
    depositAmountMinor: this.depositAmountMinor,
    cancellationWindowHours: this.cancellationWindowHours,
    minNoticeMinutes: this.minNoticeMinutes,
    maxAdvanceDays: this.maxAdvanceDays,
    locationIds: this.locationIds.map((id) => id.toString()),
    staffUserIds: this.staffUserIds,
    staffAssignments: this.staffAssignments,
    variants: this.variants,
    moderationStatus: this.moderationStatus,
    rejectionReason: this.rejectionReason
  };
};

serviceSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    ...this.toCardJSON(),
    description: this.description,
    media: this.media.map(publicMedia),
    basePriceMinor: this.basePriceMinor,
    bufferBeforeMinutes: this.bufferBeforeMinutes,
    bufferAfterMinutes: this.bufferAfterMinutes,
    paymentRule: this.paymentRule,
    depositAmountMinor: this.depositAmountMinor,
    cancellationWindowHours: this.cancellationWindowHours,
    variants: this.variants.filter((variant) => variant.active).map((variant) => ({ variantId: variant.variantId, name: variant.name, description: variant.description, priceMinor: variant.priceMinor, durationMinutes: variant.durationMinutes, bufferBeforeMinutes: variant.bufferBeforeMinutes, bufferAfterMinutes: variant.bufferAfterMinutes, media: variant.media.map(publicMedia) }))
  };
};

serviceSchema.methods.toSnapshot = function toSnapshot(variantId) {
  const variant = variantId ? this.variants.find((item) => item.variantId.toString() === variantId.toString()) : null;
  const cover = variant?.media?.find((media) => media.isCover) || variant?.media?.[0] || this.media.find((media) => media.isCover) || this.media[0] || null;
  return {
    serviceId: this._id,
    variantId: variant?.variantId || null,
    serviceName: this.name,
    variantName: variant?.name || null,
    description: variant?.description || this.shortDescription || this.description,
    priceMinor: variant?.priceMinor || this.basePriceMinor,
    durationMinutes: variant?.durationMinutes || this.durationMinutes,
    bufferBeforeMinutes: variant?.bufferBeforeMinutes ?? this.bufferBeforeMinutes,
    bufferAfterMinutes: variant?.bufferAfterMinutes ?? this.bufferAfterMinutes,
    cancellationWindowHours: this.cancellationWindowHours,
    currency: this.currency,
    image: cover?.url || null,
    businessId: this.businessId?._id || this.businessId
  };
};

const Service = mongoose.model('Service', serviceSchema);

module.exports = { Service, SERVICE_STATUSES, MODERATION_STATUSES, LOCATION_TYPES, PAYMENT_RULES, mediaSchema, variantSchema, staffAssignmentSchema };
