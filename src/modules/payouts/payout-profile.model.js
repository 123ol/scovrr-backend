const mongoose = require('mongoose');

const payoutProfileSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, unique: true, index: true },
  provider: { type: String, required: true, trim: true, maxlength: 80, default: 'paystack' },
  recipientCode: { type: String, required: true, trim: true, maxlength: 200 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3, default: 'NGN' },
  status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending', index: true },
  verifiedAt: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, versionKey: false });

payoutProfileSchema.methods.toSafeJSON = function toSafeJSON() {
  const recipientCode = this.recipientCode || '';
  return { id: this._id.toString(), businessId: this.businessId.toString(), provider: this.provider, recipientCode: recipientCode ? `${recipientCode.slice(0, 3)}…${recipientCode.slice(-4)}` : null, currency: this.currency, status: this.status, verifiedAt: this.verifiedAt, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const PayoutProfile = mongoose.model('PayoutProfile', payoutProfileSchema);

module.exports = { PayoutProfile };
