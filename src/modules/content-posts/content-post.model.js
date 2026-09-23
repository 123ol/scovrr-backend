const mongoose = require('mongoose');
const { publicMedia } = require('../media/catalogue-media.service');

const CONTENT_POST_TYPES = ['announcement', 'product_update', 'service_update', 'offer', 'tip'];
const CONTENT_POST_STATUSES = ['draft', 'pending_review', 'active', 'rejected', 'archived'];

function idString(value) {
  return value?._id?.toString() || value?.toString() || null;
}

function publicReference(value, type) {
  if (!value?.name || !value?._id) return null;
  const cover = value.media?.find((media) => media.isCover) || value.media?.[0] || null;
  return {
    id: value._id.toString(),
    type,
    name: value.name,
    slug: value.slug,
    image: cover?.url || null,
    priceMinor: value.basePriceMinor || null,
    currency: value.currency || null
  };
}

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true, trim: true, maxlength: 2_000 },
  provider: { type: String, trim: true, maxlength: 80 },
  publicId: { type: String, trim: true, maxlength: 300 },
  uploadSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogueUploadSession', default: null },
  mimeType: { type: String, trim: true, maxlength: 100 },
  alt: { type: String, trim: true, maxlength: 200 },
  order: { type: Number, min: 0, max: 20, default: 0 }
}, { _id: false });

const contentPostSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: CONTENT_POST_TYPES, required: true, default: 'announcement' },
  title: { type: String, trim: true, maxlength: 180, default: '' },
  body: { type: String, trim: true, default: '', maxlength: 5_000 },
  media: { type: [mediaSchema], default: [] },
  linkedProductId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  linkedServiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
  commentsCount: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: CONTENT_POST_STATUSES, default: 'draft', index: true },
  moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'removed'], default: 'pending', index: true },
  rejectionReason: { type: String, trim: true, maxlength: 1_000, default: null },
  publishedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

contentPostSchema.index({ businessId: 1, status: 1, createdAt: -1 });
contentPostSchema.index({ status: 1, moderationStatus: 1, createdAt: -1 });

contentPostSchema.methods.toOwnerJSON = function toOwnerJSON() {
  return {
    id: this._id.toString(),
    businessId: idString(this.businessId),
    authorId: idString(this.authorId),
    type: this.type,
    title: this.title,
    body: this.body,
    media: this.media,
    linkedProductId: idString(this.linkedProductId),
    linkedServiceId: idString(this.linkedServiceId),
    commentsCount: this.commentsCount || 0,
    status: this.status,
    moderationStatus: this.moderationStatus,
    rejectionReason: this.rejectionReason,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

contentPostSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    businessId: idString(this.businessId),
    type: this.type,
    title: this.title,
    body: this.body,
    media: this.media.map(publicMedia),
    linkedProductId: idString(this.linkedProductId),
    linkedServiceId: idString(this.linkedServiceId),
    reference: publicReference(this.linkedProductId, 'product') || publicReference(this.linkedServiceId, 'service'),
    business: this.businessId?.name ? { id: idString(this.businessId), name: this.businessId.name, slug: this.businessId.slug } : null,
    commentsCount: this.commentsCount || 0,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt
  };
};

const ContentPost = mongoose.model('ContentPost', contentPostSchema);

module.exports = { ContentPost, CONTENT_POST_TYPES, CONTENT_POST_STATUSES };
