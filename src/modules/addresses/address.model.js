const mongoose = require('mongoose');

const addressPointSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], validate: (value) => value.length === 2 }
}, { _id: false });

const addressSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  label: { type: String, enum: ['Home', 'Work', 'Other'], required: true },
  recipientName: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, trim: true, maxlength: 32 },
  addressLine1: { type: String, required: true, trim: true, maxlength: 200 },
  addressLine2: { type: String, trim: true, maxlength: 200 },
  area: { type: String, trim: true, maxlength: 120 },
  city: { type: String, required: true, trim: true, maxlength: 120 },
  state: { type: String, required: true, trim: true, maxlength: 120 },
  country: { type: String, required: true, trim: true, maxlength: 120 },
  landmark: { type: String, trim: true, maxlength: 200 },
  location: { type: addressPointSchema, default: undefined },
  deliveryInstructions: { type: String, trim: true, maxlength: 500 },
  isDefault: { type: Boolean, default: false, index: true }
}, { timestamps: true, versionKey: false });

addressSchema.index({ userId: 1, createdAt: -1 });

addressSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    label: this.label,
    recipientName: this.recipientName,
    phone: this.phone,
    addressLine1: this.addressLine1,
    addressLine2: this.addressLine2 || null,
    area: this.area || null,
    city: this.city,
    state: this.state,
    country: this.country,
    landmark: this.landmark || null,
    location: this.location || null,
    deliveryInstructions: this.deliveryInstructions || null,
    isDefault: this.isDefault
  };
};

const Address = mongoose.model('Address', addressSchema);

module.exports = { Address };
