const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  productName: { type: String, required: true },
  variantName: { type: String, default: null },
  sku: { type: String, default: null },
  unitPriceMinor: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true },
  image: { type: String, default: null },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true }
}, { _id: false });

const addressSnapshotSchema = new mongoose.Schema({}, { _id: false, strict: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  checkoutIdempotencyKey: { type: String, trim: true, maxlength: 160 },
  businessIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Business' }], required: true },
  items: { type: [orderItemSchema], required: true },
  currency: { type: String, required: true },
  subtotalMinor: { type: Number, required: true, min: 0 },
  discountMinor: { type: Number, required: true, min: 0, default: 0 },
  deliveryDiscountMinor: { type: Number, required: true, min: 0, default: 0 },
  pricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  promotionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Promotion', default: null },
  promotionCode: { type: String, trim: true, uppercase: true, default: null },
  deliveryMinor: { type: Number, required: true, min: 0, default: 0 },
  totalMinor: { type: Number, required: true, min: 0 },
  paymentStatus: { type: String, enum: ['not_initialized', 'pending', 'successful', 'failed', 'abandoned', 'refunded', 'partially_refunded'], default: 'not_initialized', index: true },
  fulfillmentStatus: { type: String, enum: ['pending', 'seller_confirmation', 'confirmed', 'processing', 'ready_for_pickup', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'completed', 'cancelled'], default: 'pending', index: true },
  status: { type: String, enum: ['pending_payment', 'paid', 'confirmed', 'processing', 'ready_for_pickup', 'ready_for_delivery', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'refunded'], default: 'pending_payment', index: true },
  fulfillmentMethod: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
  deliveryMethod: { type: String, enum: ['customer_pickup', 'seller_delivery', 'third_party'], default: 'seller_delivery' },
  fulfillmentLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  deliveryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Delivery', default: null, index: true },
  deliverySnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  pickupCodeHint: { type: String, default: null, select: false },
  shippingAddressSnapshot: { type: addressSnapshotSchema, default: null },
  paymentReference: { type: String, unique: true, sparse: true, default: null },
  timeline: [{ status: String, actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, note: String, createdAt: { type: Date, default: Date.now } }],
  cancellation: { reason: String, cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, cancelledAt: Date },
  reservationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InventoryReservation' }]
}, { timestamps: true, versionKey: false });

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, checkoutIdempotencyKey: 1 }, { unique: true, partialFilterExpression: { checkoutIdempotencyKey: { $type: 'string' } } });
orderSchema.index({ businessIds: 1, status: 1, createdAt: -1 });

orderSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    orderNumber: this.orderNumber,
    items: this.items,
    currency: this.currency,
    subtotalMinor: this.subtotalMinor,
    discountMinor: this.discountMinor,
    deliveryDiscountMinor: this.deliveryDiscountMinor,
    pricingSnapshot: this.pricingSnapshot,
    promotionCode: this.promotionCode,
    deliveryMinor: this.deliveryMinor,
    totalMinor: this.totalMinor,
    paymentStatus: this.paymentStatus,
    fulfillmentStatus: this.fulfillmentStatus,
    status: this.status,
    fulfillmentMethod: this.fulfillmentMethod,
    deliveryMethod: this.deliveryMethod,
    fulfillmentLocationId: this.fulfillmentLocationId?.toString() || null,
    deliveryId: this.deliveryId?.toString() || null,
    delivery: this.deliverySnapshot,
    shippingAddress: this.shippingAddressSnapshot,
    timeline: this.timeline,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const Order = mongoose.model('Order', orderSchema);

module.exports = { Order, orderItemSchema };
