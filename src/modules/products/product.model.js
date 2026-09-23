const mongoose = require('mongoose');
const { publicMedia } = require('../media/catalogue-media.service');

const PRODUCT_STATUSES = ['draft', 'pending_review', 'active', 'rejected', 'archived', 'sold_out'];
const MODERATION_STATUSES = ['pending', 'approved', 'rejected', 'flagged', 'removed'];
const PRODUCT_CONDITIONS = ['new', 'like_new', 'excellent', 'good', 'fair'];

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
  attributes: { type: Map, of: String, default: {} },
  sku: { type: String, trim: true, maxlength: 100 },
  priceMinor: { type: Number, min: 1 },
  compareAtPriceMinor: { type: Number, min: 0, default: null },
  inventoryTracking: { type: Boolean, default: true },
  stockQuantity: { type: Number, min: 0, default: 0 },
  reservedQuantity: { type: Number, min: 0, default: 0 },
  availableQuantity: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, min: 0, default: 0 },
  media: { type: [mediaSchema], default: [] },
  active: { type: Boolean, default: true }
}, { _id: false });

const productSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', index: true },
  name: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 180 },
  description: { type: String, trim: true, maxlength: 5_000, default: '' },
  shortDescription: { type: String, trim: true, maxlength: 300, default: '' },
  brand: { type: String, trim: true, maxlength: 120 },
  condition: { type: String, enum: PRODUCT_CONDITIONS, default: 'new' },
  tags: { type: [String], default: [] },
  media: { type: [mediaSchema], default: [] },
  basePriceMinor: { type: Number, required: true, min: 1 },
  compareAtPriceMinor: { type: Number, min: 0, default: null },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  inventoryTracking: { type: Boolean, default: true },
  stockQuantity: { type: Number, min: 0, default: 0 },
  reservedQuantity: { type: Number, min: 0, default: 0 },
  availableQuantity: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, min: 0, default: 0 },
  variants: { type: [variantSchema], default: [] },
  status: { type: String, enum: PRODUCT_STATUSES, default: 'draft', index: true },
  moderationStatus: { type: String, enum: MODERATION_STATUSES, default: 'pending', index: true },
  publishedAt: { type: Date, default: null },
  rejectionReason: { type: String, trim: true, maxlength: 1_000, default: null },
  ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
  ratingCount: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

productSchema.index({ businessId: 1, status: 1, createdAt: -1 });
productSchema.index({ categoryId: 1, status: 1 });
productSchema.index({ tags: 1, status: 1 });

productSchema.methods.toCardJSON = function toCardJSON() {
  const businessId = this.businessId?._id || this.businessId;
  const cover = this.media.find((media) => media.isCover) || this.media[0] || null;
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    categoryId: this.categoryId?._id ? this.categoryId._id.toString() : (this.categoryId ? this.categoryId.toString() : null),
    shortDescription: this.shortDescription,
    priceMinor: this.basePriceMinor,
    compareAtPriceMinor: this.compareAtPriceMinor,
    currency: this.currency,
    condition: this.condition,
    image: cover?.url || null,
    status: this.status,
    availableQuantity: this.variants.length > 0 ? this.variants.reduce((sum, variant) => sum + (variant.availableQuantity || 0), 0) : this.availableQuantity,
    ratingAverage: this.ratingAverage,
    ratingCount: this.ratingCount,
    hasVariants: this.variants.length > 0,
    businessId: businessId.toString()
  };
};

productSchema.methods.toOwnerJSON = function toOwnerJSON() {
  const businessId = this.businessId?._id || this.businessId;
  return {
    ...this.toCardJSON(),
    businessId: businessId.toString(),
    categoryId: this.categoryId?._id ? this.categoryId._id.toString() : (this.categoryId ? this.categoryId.toString() : null),
    description: this.description,
    brand: this.brand || null,
    tags: this.tags,
    media: this.media,
    inventoryTracking: this.inventoryTracking,
    stockQuantity: this.stockQuantity,
    reservedQuantity: this.reservedQuantity,
    lowStockThreshold: this.lowStockThreshold,
    variants: this.variants,
    moderationStatus: this.moderationStatus,
    rejectionReason: this.rejectionReason
  };
};

productSchema.methods.toPublicJSON = function toPublicJSON() {
  const variants = this.variants.filter((variant) => variant.active).map((variant) => ({ variantId: variant.variantId, name: variant.name, attributes: variant.attributes, sku: variant.sku || null, priceMinor: variant.priceMinor, compareAtPriceMinor: variant.compareAtPriceMinor, media: variant.media.map(publicMedia), availableQuantity: variant.availableQuantity, inventoryTracking: variant.inventoryTracking }));
  return { ...this.toCardJSON(), description: this.description, brand: this.brand || null, tags: this.tags, media: this.media.map(publicMedia), basePriceMinor: this.basePriceMinor, compareAtPriceMinor: this.compareAtPriceMinor, variants };
};

productSchema.methods.toSnapshot = function toSnapshot(variantId, quantity) {
  const variant = variantId ? this.variants.find((item) => item.variantId.toString() === variantId.toString()) : null;
  const priceMinor = variant?.priceMinor || this.basePriceMinor;
  const cover = variant?.media?.find((media) => media.isCover) || variant?.media?.[0] || this.media.find((media) => media.isCover) || this.media[0] || null;
  return {
    productId: this._id,
    variantId: variant?.variantId || null,
    productName: this.name,
    variantName: variant?.name || null,
    sku: variant?.sku || null,
    unitPriceMinor: priceMinor,
    quantity,
    currency: this.currency,
    image: cover?.url || null,
    businessId: (this.businessId?._id || this.businessId)
  };
};

const Product = mongoose.model('Product', productSchema);

module.exports = { Product, PRODUCT_STATUSES, MODERATION_STATUSES, PRODUCT_CONDITIONS, mediaSchema, variantSchema };
