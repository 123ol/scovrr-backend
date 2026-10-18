const mongoose = require('mongoose');

const businessCustomerProfileSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tags: { type: [{ type: String, trim: true, lowercase: true, maxlength: 32 }], default: [] },
  note: { type: String, trim: true, maxlength: 2_000, default: '' },
  nextFollowUpAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true, versionKey: false });

businessCustomerProfileSchema.index({ businessId: 1, customerId: 1 }, { unique: true });
businessCustomerProfileSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), businessId: this.businessId.toString(), customerId: this.customerId.toString(), tags: this.tags || [], note: this.note || '', nextFollowUpAt: this.nextFollowUpAt || null, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const BusinessCustomerProfile = mongoose.models.BusinessCustomerProfile || mongoose.model('BusinessCustomerProfile', businessCustomerProfileSchema);

module.exports = { BusinessCustomerProfile };
