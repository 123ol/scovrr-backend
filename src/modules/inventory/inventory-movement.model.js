const mongoose = require('mongoose');

const MOVEMENT_TYPES = ['sale', 'refund', 'manual_adjustment', 'restock', 'cancellation', 'reservation', 'reservation_release', 'transfer_out', 'transfer_in', 'damaged', 'lost'];

const inventoryMovementSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  type: { type: String, enum: MOVEMENT_TYPES, required: true },
  quantityDelta: { type: Number, required: true },
  stockBefore: { type: Number, required: true },
  stockAfter: { type: Number, required: true },
  referenceType: { type: String, trim: true, maxlength: 80 },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason: { type: String, trim: true, maxlength: 500 }
}, { timestamps: true, versionKey: false });

inventoryMovementSchema.index({ productId: 1, createdAt: -1 });
inventoryMovementSchema.index({ businessId: 1, locationId: 1, createdAt: -1 });

const InventoryMovement = mongoose.model('InventoryMovement', inventoryMovementSchema);

module.exports = { InventoryMovement, MOVEMENT_TYPES };
