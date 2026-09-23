const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['product', 'service'], required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null, index: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, trim: true, maxlength: 2_000, default: '' },
  media: [{ url: { type: String, required: true, maxlength: 2_000 }, alt: { type: String, maxlength: 200 } }],
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'flagged', 'removed'], default: 'approved', index: true },
  businessResponse: { text: { type: String, maxlength: 2_000 }, respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, respondedAt: Date }
}, { timestamps: true, versionKey: false });

reviewSchema.index({ reviewerId: 1, orderId: 1, productId: 1 }, { unique: true, partialFilterExpression: { orderId: { $type: 'objectId' }, productId: { $type: 'objectId' } } });
reviewSchema.index({ reviewerId: 1, bookingId: 1, serviceId: 1 }, { unique: true, partialFilterExpression: { bookingId: { $type: 'objectId' }, serviceId: { $type: 'objectId' } } });
reviewSchema.index({ businessId: 1, status: 1, createdAt: -1 });

reviewSchema.methods.toSafeJSON = function toSafeJSON(options = {}) {
  const result = { id: this._id.toString(), targetType: this.targetType, productId: this.productId?.toString() || null, serviceId: this.serviceId?.toString() || null, businessId: this.businessId.toString(), rating: this.rating, text: this.text, media: this.media, status: this.status, businessResponse: this.businessResponse ? { text: this.businessResponse.text, respondedAt: this.businessResponse.respondedAt } : null, createdAt: this.createdAt, updatedAt: this.updatedAt };
  if (options.audience === 'admin') { result.reviewerId = this.reviewerId.toString(); result.businessResponse = this.businessResponse; }
  return result;
};

const Review = mongoose.model('Review', reviewSchema);

module.exports = { Review };
