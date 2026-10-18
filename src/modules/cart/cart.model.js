const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  quantity: { type: Number, min: 1, max: 99, required: true },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

const cartSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: { type: [cartItemSchema], default: [], validate: [(items) => items.length <= 100, 'A cart cannot contain more than 100 lines'] },
  appliedCouponCode: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },
  abandonedReminderSentAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

const Cart = mongoose.model('Cart', cartSchema);

module.exports = { Cart, cartItemSchema };
