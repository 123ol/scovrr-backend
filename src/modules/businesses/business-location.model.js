const mongoose = require('mongoose');

const pointSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: {
    type: [Number],
    validate: {
      validator: (value) => value.length === 2 && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90,
      message: 'Coordinates must be [longitude, latitude]'
    }
  }
}, { _id: false });

const addressSchema = new mongoose.Schema({
  addressLine1: { type: String, trim: true, maxlength: 200 },
  addressLine2: { type: String, trim: true, maxlength: 200 },
  area: { type: String, trim: true, maxlength: 120 },
  city: { type: String, required: true, trim: true, maxlength: 120 },
  state: { type: String, required: true, trim: true, maxlength: 120 },
  country: { type: String, required: true, trim: true, maxlength: 120 },
  landmark: { type: String, trim: true, maxlength: 200 }
}, { _id: false });

const openingIntervalSchema = new mongoose.Schema({
  start: { type: String, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/ },
  end: { type: String, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/ }
}, { _id: false });

const openingHoursSchema = new mongoose.Schema({
  dayOfWeek: { type: Number, min: 0, max: 6, required: true },
  intervals: { type: [openingIntervalSchema], default: [] },
  closed: { type: Boolean, default: false }
}, { _id: false });

const locationSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, trim: true, uppercase: true, maxlength: 32 },
  address: { type: addressSchema, required: true },
  contactPhone: { type: String, trim: true, maxlength: 40, default: null },
  location: { type: pointSchema, default: undefined },
  timezone: { type: String, required: true, default: 'Africa/Lagos', maxlength: 80 },
  openingHours: { type: [openingHoursSchema], default: [] },
  specialHours: { type: [{ date: String, intervals: [openingIntervalSchema], closed: Boolean, note: String }], default: [] },
  publiclyVisible: { type: Boolean, default: true },
  publicExactAddress: { type: Boolean, default: true },
  serviceAvailable: { type: Boolean, default: true },
  pickupAvailable: { type: Boolean, default: false },
  pickupInstructions: { type: String, trim: true, maxlength: 1_000, default: '' },
  pickupPreparationMinutes: { type: Number, min: 0, max: 10_080, default: 30 },
  delivery: {
    enabled: { type: Boolean, default: false },
    flatFeeMinor: { type: Number, min: 0, default: 0 },
    freeDeliveryThresholdMinor: { type: Number, min: 0, default: null },
    estimatedDeliveryMinutes: { type: Number, min: 1, max: 10_080, default: 120 }
  },
  primary: { type: Boolean, default: false, index: true },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true, versionKey: false });

locationSchema.index({ location: '2dsphere' });
locationSchema.index({ businessId: 1, active: 1 });
locationSchema.index({ businessId: 1, primary: 1 });
locationSchema.index({ businessId: 1, code: 1 }, { unique: true, sparse: true });

locationSchema.methods.toJSONSafe = function toJSONSafe(includePrivate = false) {
  const output = {
    id: this._id.toString(),
    businessId: this.businessId.toString(),
    name: this.name,
    code: this.code || null,
    city: this.address.city,
    state: this.address.state,
    country: this.address.country,
    area: this.address.area || null,
    contactPhone: this.contactPhone || null,
    timezone: this.timezone,
    openingHours: this.openingHours,
    specialHours: this.specialHours,
    publiclyVisible: this.publiclyVisible,
    publicExactAddress: this.publicExactAddress,
    serviceAvailable: this.serviceAvailable,
    pickupAvailable: this.pickupAvailable,
    pickupInstructions: this.pickupInstructions,
    pickupPreparationMinutes: this.pickupPreparationMinutes,
    delivery: this.delivery,
    primary: this.primary,
    active: this.active
  };

  if (includePrivate || this.publiclyVisible) {
    output.address = this.publicExactAddress || includePrivate ? this.address : { area: this.address.area || null, city: this.address.city, state: this.address.state, country: this.address.country };
    output.location = this.publicExactAddress || includePrivate ? (this.location || null) : null;
  }
  return output;
};

const BusinessLocation = mongoose.model('BusinessLocation', locationSchema);

module.exports = { BusinessLocation };
