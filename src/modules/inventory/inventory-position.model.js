const mongoose = require('mongoose');

const inventoryPositionSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  variantKey: { type: String, required: true },
  inventoryTracking: { type: Boolean, default: true },
  quantityOnHand: { type: Number, min: 0, default: 0 },
  quantityReserved: { type: Number, min: 0, default: 0 },
  quantityAvailable: { type: Number, min: 0, default: 0 },
  lowStockThreshold: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

inventoryPositionSchema.index({ businessId: 1, locationId: 1, productId: 1, variantKey: 1 }, { unique: true });
inventoryPositionSchema.index({ locationId: 1, quantityAvailable: 1 });

inventoryPositionSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), businessId: this.businessId.toString(), locationId: this.locationId.toString(), productId: this.productId.toString(), variantId: this.variantId?.toString() || null, inventoryTracking: this.inventoryTracking, quantityOnHand: this.quantityOnHand, quantityReserved: this.quantityReserved, quantityAvailable: this.quantityAvailable, lowStockThreshold: this.lowStockThreshold, lowStock: this.inventoryTracking && this.quantityAvailable <= this.lowStockThreshold, updatedAt: this.updatedAt };
};

const InventoryPosition = mongoose.model('InventoryPosition', inventoryPositionSchema);

module.exports = { InventoryPosition };
