const mongoose = require('mongoose');

const productPriceHistorySchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  basePriceMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true },
  variants: { type: [{ variantId: mongoose.Schema.Types.ObjectId, name: String, priceMinor: Number, currency: String }], default: [] },
  reason: { type: String, trim: true, maxlength: 240, default: 'catalogue_price_update' }
}, { timestamps: true, versionKey: false });
productPriceHistorySchema.index({ productId: 1, createdAt: -1 });
const ProductPriceHistory = mongoose.model('ProductPriceHistory', productPriceHistorySchema);
module.exports = { ProductPriceHistory };
