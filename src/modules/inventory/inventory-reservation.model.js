const mongoose = require('mongoose');

const RESERVATION_STATUSES = ['active', 'released', 'consumed'];

const inventoryReservationSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  quantity: { type: Number, required: true, min: 1 },
  status: { type: String, enum: RESERVATION_STATUSES, default: 'active', index: true },
  expiresAt: { type: Date, required: true, index: true }
}, { timestamps: true, versionKey: false });

inventoryReservationSchema.index({ status: 1, expiresAt: 1 });

const InventoryReservation = mongoose.model('InventoryReservation', inventoryReservationSchema);

module.exports = { InventoryReservation, RESERVATION_STATUSES };
