const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  idempotencyKey: { type: String, required: true, unique: true, index: true },
  accountType: { type: String, enum: ['platform', 'business', 'customer'], required: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null, index: true },
  type: { type: String, enum: ['customer_payment', 'subscription_payment', 'subscription_refund', 'promotion_funding', 'promotion_refund', 'platform_commission', 'seller_credit', 'refund', 'seller_debit', 'payout', 'payout_reversal'], required: true },
  direction: { type: String, enum: ['credit', 'debit'], required: true },
  amountMinor: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

ledgerEntrySchema.index({ businessId: 1, createdAt: -1 });

const LedgerEntry = mongoose.model('LedgerEntry', ledgerEntrySchema);

module.exports = { LedgerEntry };
