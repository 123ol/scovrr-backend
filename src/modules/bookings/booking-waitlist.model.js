const mongoose = require('mongoose');

const WAITLIST_STATUSES = ['waiting', 'offered', 'accepting', 'converted', 'cancelled', 'expired'];

const bookingWaitlistSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  locationType: { type: String, enum: ['at_business', 'at_customer', 'online', 'mobile'], required: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null },
  preferredStartAt: { type: Date, default: null, index: true },
  status: { type: String, enum: WAITLIST_STATUSES, default: 'waiting', index: true },
  offerExpiresAt: { type: Date, default: null },
  offeredAt: { type: Date, default: null },
  offeredStartAt: { type: Date, default: null },
  convertedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

bookingWaitlistSchema.index({ serviceId: 1, status: 1, preferredStartAt: 1, createdAt: 1 });
bookingWaitlistSchema.index({ customerId: 1, serviceId: 1, status: 1 });

bookingWaitlistSchema.methods.toSafeJSON = function toSafeJSON() {
  const service = this.serviceId && typeof this.serviceId === 'object' && this.serviceId.name
    ? { id: this.serviceId._id.toString(), name: this.serviceId.name, slug: this.serviceId.slug }
    : null;
  const business = this.businessId && typeof this.businessId === 'object' && this.businessId.name
    ? { id: this.businessId._id.toString(), name: this.businessId.name, slug: this.businessId.slug }
    : null;
  return {
    id: this._id.toString(), customerId: this.customerId.toString(), businessId: business?.id || this.businessId.toString(), serviceId: service?.id || this.serviceId.toString(),
    business, service,
    staffUserId: this.staffUserId?.toString() || null, locationType: this.locationType, locationId: this.locationId?.toString() || null,
    preferredStartAt: this.preferredStartAt, status: this.status, offerExpiresAt: this.offerExpiresAt, offeredAt: this.offeredAt, offeredStartAt: this.offeredStartAt,
    convertedBookingId: this.convertedBookingId?.toString() || null, createdAt: this.createdAt, updatedAt: this.updatedAt
  };
};

const BookingWaitlist = mongoose.model('BookingWaitlist', bookingWaitlistSchema);

module.exports = { BookingWaitlist, WAITLIST_STATUSES };
