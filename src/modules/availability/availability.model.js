const mongoose = require('mongoose');

const intervalSchema = new mongoose.Schema({
  start: { type: String, required: true },
  end: { type: String, required: true }
}, { _id: false });

const weeklyRuleSchema = new mongoose.Schema({
  dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
  intervals: { type: [intervalSchema], default: [] },
  enabled: { type: Boolean, default: true }
}, { _id: false });

const overrideSchema = new mongoose.Schema({
  date: { type: String, required: true },
  intervals: { type: [intervalSchema], default: [] },
  closed: { type: Boolean, default: false },
  note: { type: String, trim: true, maxlength: 300 }
}, { _id: false });

const availabilitySchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  timezone: { type: String, required: true, default: 'Africa/Lagos' },
  slotIntervalMinutes: { type: Number, min: 5, max: 120, default: 30 },
  weeklyRules: { type: [weeklyRuleSchema], default: [] },
  overrides: { type: [overrideSchema], default: [] }
}, { timestamps: true, versionKey: false });

availabilitySchema.index({ businessId: 1, locationId: 1, staffUserId: 1 }, { unique: true });

const AvailabilityRule = mongoose.model('AvailabilityRule', availabilitySchema);

module.exports = { AvailabilityRule, intervalSchema, weeklyRuleSchema, overrideSchema };
