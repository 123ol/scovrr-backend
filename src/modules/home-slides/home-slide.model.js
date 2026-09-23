const mongoose = require('mongoose');

const HOME_SLIDE_TARGET_TYPES = ['marketplace', 'product'];
const HOME_SLIDE_STATUSES = ['draft', 'active', 'archived'];

function idString(value) {
  return value?._id?.toString() || value?.toString() || null;
}

function productJSON(product) {
  if (!product?._id || !product.name) return null;
  const cover = product.media?.find((media) => media.isCover) || product.media?.[0] || null;
  return {
    id: product._id.toString(),
    name: product.name,
    slug: product.slug,
    image: cover?.url || null,
    priceMinor: product.basePriceMinor,
    currency: product.currency
  };
}

const homeSlideSchema = new mongoose.Schema({
  eyebrow: { type: String, trim: true, maxlength: 80, default: 'NEW ARRIVALS' },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  subtitle: { type: String, trim: true, maxlength: 300, default: '' },
  imageUrl: { type: String, required: true, trim: true, maxlength: 2_000 },
  targetType: { type: String, enum: HOME_SLIDE_TARGET_TYPES, required: true, default: 'marketplace' },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  sortOrder: { type: Number, min: 0, max: 100_000, default: 0, index: true },
  status: { type: String, enum: HOME_SLIDE_STATUSES, default: 'draft', index: true },
  startsAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, versionKey: false });

homeSlideSchema.index({ status: 1, sortOrder: 1, createdAt: -1 });
homeSlideSchema.index({ status: 1, startsAt: 1, endsAt: 1 });

homeSlideSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    eyebrow: this.eyebrow,
    title: this.title,
    subtitle: this.subtitle,
    imageUrl: this.imageUrl,
    targetType: this.targetType,
    product: this.targetType === 'product' ? productJSON(this.productId) : null,
    sortOrder: this.sortOrder
  };
};

homeSlideSchema.methods.toAdminJSON = function toAdminJSON() {
  return {
    ...this.toPublicJSON(),
    productId: idString(this.productId),
    status: this.status,
    startsAt: this.startsAt,
    endsAt: this.endsAt,
    createdBy: idString(this.createdBy),
    updatedBy: idString(this.updatedBy),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const HomeSlide = mongoose.model('HomeSlide', homeSlideSchema);

module.exports = { HomeSlide, HOME_SLIDE_TARGET_TYPES, HOME_SLIDE_STATUSES };
