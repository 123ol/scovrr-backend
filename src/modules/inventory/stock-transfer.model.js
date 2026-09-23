const mongoose = require('mongoose');

const TRANSFER_STATUSES = ['draft', 'pending', 'in_transit', 'received', 'cancelled'];

const stockTransferSchema = new mongoose.Schema({
  transferNumber: { type: String, required: true, unique: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  sourceLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', required: true, index: true },
  destinationLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', required: true, index: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  quantity: { type: Number, required: true, min: 1 },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: TRANSFER_STATUSES, default: 'pending', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

stockTransferSchema.index({ businessId: 1, status: 1, createdAt: -1 });

stockTransferSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), transferNumber: this.transferNumber, businessId: this.businessId.toString(), sourceLocationId: this.sourceLocationId.toString(), destinationLocationId: this.destinationLocationId.toString(), productId: this.productId.toString(), variantId: this.variantId?.toString() || null, quantity: this.quantity, reason: this.reason, status: this.status, createdBy: this.createdBy.toString(), receivedBy: this.receivedBy?.toString() || null, receivedAt: this.receivedAt, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const StockTransfer = mongoose.model('StockTransfer', stockTransferSchema);

module.exports = { StockTransfer, TRANSFER_STATUSES };
