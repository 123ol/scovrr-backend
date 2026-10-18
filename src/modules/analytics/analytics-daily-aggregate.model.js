const mongoose = require('mongoose');

const aggregateSchema = new mongoose.Schema({
  dateKey: { type: String, required: true, index: true },
  scope: { type: String, enum: ['business', 'platform'], required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  entityType: { type: String, enum: ['business', 'product', 'service', 'content_post', 'category', null], default: null },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  currency: { type: String, uppercase: true, minlength: 3, maxlength: 3, default: null },
  views: { type: Number, min: 0, default: 0 },
  uniqueViews: { type: Number, min: 0, default: 0 },
  watchSeconds: { type: Number, min: 0, default: 0 },
  searches: { type: Number, min: 0, default: 0 },
  searchClicks: { type: Number, min: 0, default: 0 },
  saves: { type: Number, min: 0, default: 0 },
  unsaves: { type: Number, min: 0, default: 0 },
  addsToCart: { type: Number, min: 0, default: 0 },
  removesFromCart: { type: Number, min: 0, default: 0 },
  checkouts: { type: Number, min: 0, default: 0 },
  bookingStarts: { type: Number, min: 0, default: 0 },
  orders: { type: Number, min: 0, default: 0 },
  bookings: { type: Number, min: 0, default: 0 },
  completedOrders: { type: Number, min: 0, default: 0 },
  completedBookings: { type: Number, min: 0, default: 0 },
  reviews: { type: Number, min: 0, default: 0 },
  promotionImpressions: { type: Number, min: 0, default: 0 },
  promotionClicks: { type: Number, min: 0, default: 0 },
  promotionConversions: { type: Number, min: 0, default: 0 },
  grossSalesMinor: { type: Number, min: 0, default: 0 },
  netSalesMinor: { type: Number, min: 0, default: 0 },
  refundsMinor: { type: Number, min: 0, default: 0 },
  platformRevenueMinor: { type: Number, min: 0, default: 0 },
  subscriptionRevenueMinor: { type: Number, min: 0, default: 0 },
  promotionRevenueMinor: { type: Number, min: 0, default: 0 },
  customers: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

aggregateSchema.index({ scope: 1, dateKey: 1, businessId: 1, locationId: 1, entityType: 1, entityId: 1, currency: 1 }, { unique: true });
aggregateSchema.index({ businessId: 1, dateKey: -1, entityType: 1 });

const AnalyticsDailyAggregate = mongoose.model('AnalyticsDailyAggregate', aggregateSchema);
module.exports = { AnalyticsDailyAggregate };
