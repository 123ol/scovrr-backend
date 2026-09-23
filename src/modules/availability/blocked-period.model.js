const mongoose = require('mongoose');

const blockedPeriodSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true, index: true },
  reason: { type: String, trim: true, maxlength: 500, default: '' },
  active: { type: Boolean, default: true }
}, { timestamps: true, versionKey: false });

blockedPeriodSchema.index({ businessId: 1, startAt: 1, endAt: 1 });

const BlockedPeriod = mongoose.model('BlockedPeriod', blockedPeriodSchema);

module.exports = { BlockedPeriod };
