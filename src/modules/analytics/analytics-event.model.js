const mongoose = require('mongoose');
const { ANALYTICS_EVENT_NAMES, EVENT_AUTHORITIES, EVENT_ACTORS, EVENT_PLATFORMS, EVENT_SOURCES } = require('./event-registry');

const ANALYTICS_EVENTS = [...ANALYTICS_EVENT_NAMES, 'home_impression', 'business_impression', 'product_impression', 'product_view', 'service_view', 'search', 'search_click', 'favorite', 'add_to_cart', 'checkout_started', 'purchase', 'booking', 'follow', 'message_started', 'review_created'];

const analyticsEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, sparse: true, index: true, trim: true, maxlength: 100 },
  eventVersion: { type: Number, required: true, min: 1, default: 1 },
  authority: { type: String, enum: Object.values(EVENT_AUTHORITIES), required: true, index: true },
  actorType: { type: String, enum: EVENT_ACTORS, required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  anonymousSessionId: { type: String, trim: true, maxlength: 120, default: null, index: true },
  eventName: { type: String, enum: ANALYTICS_EVENTS, required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessLocation', default: null, index: true },
  categoryIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }], default: [] },
  entityType: { type: String, trim: true, maxlength: 60, default: null, index: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  source: { type: String, enum: EVENT_SOURCES, default: 'APP', index: true },
  placement: { type: String, trim: true, maxlength: 80, default: null },
  platform: { type: String, enum: EVENT_PLATFORMS, default: 'server' },
  appVersion: { type: String, trim: true, maxlength: 40, default: null },
  sessionId: { type: String, trim: true, maxlength: 120, default: null, index: true },
  attribution: { type: mongoose.Schema.Types.Mixed, default: {} },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  properties: { type: mongoose.Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, default: Date.now, index: true },
  receivedAt: { type: Date, default: Date.now, index: true },
  dedupeKey: { type: String, unique: true, sparse: true, index: true, maxlength: 180 },
  retentionClass: { type: String, enum: ['domain', 'financial', 'behavioral', 'short_behavioral'], default: 'behavioral', index: true },
  aggregatedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

analyticsEventSchema.index({ eventName: 1, occurredAt: -1 });
analyticsEventSchema.index({ businessId: 1, occurredAt: -1, eventName: 1 });
analyticsEventSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
analyticsEventSchema.index({ actorId: 1, entityType: 1, entityId: 1, occurredAt: -1 });
analyticsEventSchema.index({ retentionClass: 1, occurredAt: 1 });

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

module.exports = { AnalyticsEvent, ANALYTICS_EVENTS };
