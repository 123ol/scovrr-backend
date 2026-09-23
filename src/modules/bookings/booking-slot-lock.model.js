const mongoose = require('mongoose');

const bookingSlotLockSchema = new mongoose.Schema({
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  resourceKey: { type: String, required: true },
  bucketStart: { type: Date, required: true },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, versionKey: false });

bookingSlotLockSchema.index({ resourceKey: 1, bucketStart: 1 }, { unique: true });
bookingSlotLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const BookingSlotLock = mongoose.model('BookingSlotLock', bookingSlotLockSchema);

module.exports = { BookingSlotLock };
