const mongoose = require('mongoose');

const PROMOTION_STATUSES = ['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'];
const PROMOTION_VALUE_TYPES = ['percentage', 'fixed', 'fixed_amount', 'free_delivery'];
const PROMOTION_TARGET_TYPES = ['business', 'product', 'product_variant', 'category', 'service', 'service_variant', 'order', 'booking', 'delivery'];
const PROMOTION_FUNDERS = ['business', 'platform'];

const promotionSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 140 },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  code: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },
  kind: { type: String, enum: ['automatic', 'coupon'], default: 'automatic', index: true },
  discountType: { type: String, enum: ['percentage', 'fixed_amount', 'free_delivery'], default: null },
  targetType: { type: String, enum: PROMOTION_TARGET_TYPES, default: 'business' },
  productIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  productVariantIds: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: [] },
  categoryIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], default: [] },
  serviceIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }], default: [] },
  serviceVariantIds: { type: [{ type: mongoose.Schema.Types.ObjectId }], default: [] },
  locationIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation' }], default: [] },
  excludedProductIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
  excludedServiceIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }], default: [] },
  valueType: { type: String, enum: PROMOTION_VALUE_TYPES, required: true },
  value: { type: Number, required: true, min: 1 },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: null },
  maxDiscountMinor: { type: Number, min: 1, default: null },
  minimumSubtotalMinor: { type: Number, min: 0, default: 0 },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  usageLimit: { type: Number, min: 1, default: null },
  usageCount: { type: Number, min: 0, default: 0 },
  reservedCount: { type: Number, min: 0, default: 0 },
  perUserLimit: { type: Number, min: 1, default: null },
  minimumOrderCount: { type: Number, min: 0, default: null },
  firstPurchaseOnly: { type: Boolean, default: false },
  firstBookingOnly: { type: Boolean, default: false },
  newCustomerOnly: { type: Boolean, default: false },
  stackable: { type: Boolean, default: false },
  priority: { type: Number, min: 0, max: 10_000, default: 0 },
  fundedBy: { type: String, enum: PROMOTION_FUNDERS, default: 'business' },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null },
  timezone: { type: String, trim: true, maxlength: 80, default: 'Africa/Lagos' },
  status: { type: String, enum: PROMOTION_STATUSES, default: 'draft', index: true },
  sponsored: { type: Boolean, default: false }
}, { timestamps: true, versionKey: false });

promotionSchema.index({ businessId: 1, code: 1 }, { unique: true, partialFilterExpression: { code: { $type: 'string' } } });
promotionSchema.index({ businessId: 1, status: 1, startsAt: 1, endsAt: 1, priority: -1 });
promotionSchema.index({ businessId: 1, kind: 1, status: 1, startsAt: 1, endsAt: 1 });

promotionSchema.methods.toSafeJSON = function toSafeJSON() {
  const businessId = this.businessId?._id || this.businessId;
  return { id: this._id.toString(), businessId: businessId.toString(), name: this.name, description: this.description, code: this.code, kind: this.kind, discountType: this.discountType || (this.valueType === 'fixed' ? 'fixed_amount' : this.valueType), targetType: this.targetType, productIds: this.productIds.map((id) => id.toString()), productVariantIds: this.productVariantIds.map((id) => id.toString()), categoryIds: this.categoryIds.map((id) => id.toString()), serviceIds: this.serviceIds.map((id) => id.toString()), serviceVariantIds: this.serviceVariantIds.map((id) => id.toString()), locationIds: this.locationIds.map((id) => id.toString()), excludedProductIds: this.excludedProductIds.map((id) => id.toString()), excludedServiceIds: this.excludedServiceIds.map((id) => id.toString()), valueType: this.valueType, value: this.value, currency: this.currency, maxDiscountMinor: this.maxDiscountMinor, minimumSubtotalMinor: this.minimumSubtotalMinor, perUserLimit: this.perUserLimit, minimumOrderCount: this.minimumOrderCount, firstPurchaseOnly: this.firstPurchaseOnly, firstBookingOnly: this.firstBookingOnly, newCustomerOnly: this.newCustomerOnly, stackable: this.stackable, priority: this.priority, fundedBy: this.fundedBy, timezone: this.timezone, startsAt: this.startsAt, endsAt: this.endsAt, usageLimit: this.usageLimit, usageCount: this.usageCount, reservedCount: this.reservedCount, status: this.status, sponsored: this.sponsored, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const Promotion = mongoose.model('Promotion', promotionSchema);

module.exports = { Promotion, Discount: Promotion, PROMOTION_STATUSES, PROMOTION_VALUE_TYPES, PROMOTION_TARGET_TYPES, PROMOTION_FUNDERS };
