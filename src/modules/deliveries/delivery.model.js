const mongoose = require('mongoose');

const DELIVERY_METHODS = ['customer_pickup', 'seller_delivery', 'third_party'];
const DELIVERY_STATUSES = ['pending', 'ready_for_pickup', 'awaiting_courier', 'picked_up', 'in_transit', 'delivery_attempted', 'delivered', 'failed', 'cancelled', 'picked_up_by_customer', 'completed'];

const addressSnapshotSchema = new mongoose.Schema({}, { _id: false, strict: false });

const deliverySchema = new mongoose.Schema({
  deliveryNumber: { type: String, required: true, unique: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', required: true, index: true },
  method: { type: String, enum: DELIVERY_METHODS, required: true },
  provider: { type: String, required: true },
  pickupAddressSnapshot: { type: addressSnapshotSchema, default: null },
  destinationAddressSnapshot: { type: addressSnapshotSchema, default: null },
  providerReference: { type: String, trim: true, maxlength: 200, default: null },
  feeMinor: { type: Number, min: 0, default: 0 },
  currency: { type: String, required: true },
  status: { type: String, enum: DELIVERY_STATUSES, default: 'pending', index: true },
  pickupCodeHash: { type: String, select: false, default: null },
  pickupCodeUsedAt: { type: Date, default: null },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  estimatedPickupAt: { type: Date, default: null },
  estimatedDeliveryAt: { type: Date, default: null },
  pickedUpAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  proof: { type: mongoose.Schema.Types.Mixed, default: null },
  tracking: { type: mongoose.Schema.Types.Mixed, default: {} },
  timeline: [{ status: String, actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, note: String, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true, versionKey: false });

deliverySchema.index({ businessId: 1, status: 1, createdAt: -1 });
deliverySchema.index({ locationId: 1, status: 1 });

deliverySchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), deliveryNumber: this.deliveryNumber, orderId: this.orderId.toString(), businessId: this.businessId.toString(), locationId: this.locationId.toString(), method: this.method, provider: this.provider, pickupAddress: this.pickupAddressSnapshot, destinationAddress: this.destinationAddressSnapshot, providerReference: this.providerReference, feeMinor: this.feeMinor, currency: this.currency, status: this.status, estimatedPickupAt: this.estimatedPickupAt, estimatedDeliveryAt: this.estimatedDeliveryAt, pickedUpAt: this.pickedUpAt, deliveredAt: this.deliveredAt, proof: this.proof, tracking: this.tracking, timeline: this.timeline, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const Delivery = mongoose.model('Delivery', deliverySchema);

module.exports = { Delivery, DELIVERY_METHODS, DELIVERY_STATUSES };
