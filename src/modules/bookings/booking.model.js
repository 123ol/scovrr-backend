const mongoose = require('mongoose');

const ACTIVE_BOOKING_STATUSES = ['pending_payment', 'requested', 'confirmed', 'upcoming', 'checked_in', 'in_progress', 'reschedule_requested'];

const serviceSnapshotSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  variantId: { type: mongoose.Schema.Types.ObjectId, default: null },
  serviceName: { type: String, required: true },
  variantName: { type: String, default: null },
  description: { type: String, default: '' },
  priceMinor: { type: Number, required: true, min: 0 },
  durationMinutes: { type: Number, required: true, min: 1 },
  bufferBeforeMinutes: { type: Number, min: 0, default: 0 },
  bufferAfterMinutes: { type: Number, min: 0, default: 0 },
  cancellationWindowHours: { type: Number, min: 0, default: 24 },
  currency: { type: String, required: true },
  image: { type: String, default: null },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true }
}, { _id: false });

const addressSnapshotSchema = new mongoose.Schema({}, { _id: false, strict: false });

const bookingSchema = new mongoose.Schema({
  bookingNumber: { type: String, required: true, unique: true, index: true },
  clientRequestId: { type: String, unique: true, sparse: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
  serviceSnapshot: { type: serviceSnapshotSchema, required: true },
  serviceItems: { type: [serviceSnapshotSchema], default: [] },
  totalDurationMinutes: { type: Number, min: 1, default: null },
  staffUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  locationType: { type: String, enum: ['at_business', 'at_customer', 'online', 'mobile'], required: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null },
  addressSnapshot: { type: addressSnapshotSchema, default: null },
  startAt: { type: Date, required: true, index: true },
  endAt: { type: Date, required: true, index: true },
  timezone: { type: String, required: true },
  customerNotes: { type: String, trim: true, maxlength: 2_000, default: '' },
  priceMinor: { type: Number, required: true, min: 0 },
  depositMinor: { type: Number, required: true, min: 0, default: 0 },
  discountMinor: { type: Number, required: true, min: 0, default: 0 },
  couponCode: { type: String, trim: true, uppercase: true, default: null },
  pricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  currency: { type: String, required: true },
  requestType: { type: String, enum: ['instant', 'request'], default: 'request' },
  paymentStatus: { type: String, enum: ['not_initialized', 'pending', 'successful', 'failed', 'refunded', 'partially_refunded'], default: 'not_initialized', index: true },
  status: { type: String, enum: [...ACTIVE_BOOKING_STATUSES, 'rejected', 'cancelled_by_customer', 'cancelled_by_business', 'no_show', 'completed', 'refund_pending', 'refunded', 'disputed'], default: 'requested', index: true },
  holdExpiresAt: { type: Date, default: null, index: true },
  cancellation: { reason: String, cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, cancelledAt: Date },
  rescheduleHistory: [{ oldStartAt: Date, oldEndAt: Date, newStartAt: Date, newEndAt: Date, requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reason: String, createdAt: { type: Date, default: Date.now } }],
  timeline: [{ status: String, actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, note: String, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true, versionKey: false });

bookingSchema.index({ businessId: 1, startAt: 1, endAt: 1, status: 1 });
bookingSchema.index({ customerId: 1, createdAt: -1 });

bookingSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    bookingNumber: this.bookingNumber,
    businessId: this.businessId.toString(),
    serviceId: this.serviceId.toString(),
    serviceSnapshot: this.serviceSnapshot,
    serviceItems: this.serviceItems?.length ? this.serviceItems : [this.serviceSnapshot],
    totalDurationMinutes: this.totalDurationMinutes || this.serviceSnapshot.durationMinutes,
    staffUserId: this.staffUserId?.toString() || null,
    locationType: this.locationType,
    locationId: this.locationId?.toString() || null,
    address: this.addressSnapshot,
    startAt: this.startAt,
    endAt: this.endAt,
    timezone: this.timezone,
    customerNotes: this.customerNotes,
    priceMinor: this.priceMinor,
    depositMinor: this.depositMinor,
    discountMinor: this.discountMinor,
    couponCode: this.couponCode,
    pricingSnapshot: this.pricingSnapshot,
    currency: this.currency,
    requestType: this.requestType,
    paymentStatus: this.paymentStatus,
    status: this.status,
    holdExpiresAt: this.holdExpiresAt,
    cancellation: this.cancellation,
    rescheduleHistory: this.rescheduleHistory,
    timeline: this.timeline,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = { Booking, ACTIVE_BOOKING_STATUSES };
