const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { AnalyticsEvent } = require('./analytics-event.model');
const { AnalyticsSession } = require('./analytics-session.model');
const { getEventDefinition, normalizeEventName, EVENT_ACTORS, EVENT_SOURCES, EVENT_PLATFORMS, EVENT_AUTHORITIES } = require('./event-registry');

const MAX_METADATA_BYTES = 2_500;
const MAX_CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1_000;
const ENTITY_MODELS = {
  business: () => require('../businesses/business.model').Business,
  product: () => require('../products/product.model').Product,
  service: () => require('../services/service.model').Service,
  order: () => require('../orders/order.model').Order,
  booking: () => require('../bookings/booking.model').Booking
};

function newEventId() { return `evt_${crypto.randomUUID()}`; }
function safeId(value) { return value && mongoose.isValidObjectId(value) ? value : null; }
function clampDate(value) {
  const now = Date.now();
  const parsed = value ? new Date(value).getTime() : now;
  if (!Number.isFinite(parsed)) throw new AppError(400, 'INVALID_EVENT_TIME', 'The event timestamp is invalid');
  return new Date(Math.max(now - MAX_CLOCK_SKEW_MS, Math.min(now + 5 * 60_000, parsed)));
}
function sanitizeMetadata(input = {}, allowedKeys = []) {
  const result = {};
  const allow = new Set(allowedKeys);
  for (const [key, value] of Object.entries(input || {})) {
    if (!allow.has(key) || !/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(key)) continue;
    if (typeof value === 'string') result[key] = value.slice(0, 300);
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'boolean' || value === null) result[key] = value;
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_METADATA_BYTES) throw new AppError(400, 'EVENT_METADATA_TOO_LARGE', 'Event metadata is too large');
  return result;
}

async function resolveEntityContext(entityType, entityId) {
  if (!entityType || !entityId || !mongoose.isValidObjectId(entityId)) return {};
  if (entityType === 'category') return { categoryIds: [entityId] };
  const factory = ENTITY_MODELS[entityType];
  if (!factory) return {};
  const Model = factory();
  const select = entityType === 'business' ? 'categories' : entityType === 'product' || entityType === 'service' ? 'businessId categoryId' : 'businessId fulfillmentLocationId locationId';
  const entity = await Model.findById(entityId).select(select).lean();
  if (!entity) return {};
  return { businessId: entity.businessId || (entityType === 'business' ? entity._id : null), locationId: entity.fulfillmentLocationId || entity.locationId || null, categoryIds: entity.categoryId ? [entity.categoryId] : entity.categories || [] };
}

async function touchSession({ sessionId, userId, platform, appVersion, occurredAt }) {
  if (!sessionId) return;
  const now = new Date();
  await AnalyticsSession.findOneAndUpdate(
    { sessionId },
    { $setOnInsert: { sessionId, userId: userId || null, anonymous: !userId, platform: platform || 'server', appVersion: appVersion || null, startedAt: occurredAt || now }, $set: { lastActivityAt: now, ...(userId ? { userId, anonymous: false } : {}) }, $inc: { eventCount: 1 } },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

function buildDocument({ definition, eventName, userId = null, actorType, actorId = null, anonymousSessionId = null, sessionId = null, entityType = null, entityId = null, source = 'SYSTEM', placement = null, platform = 'server', appVersion = null, attribution = {}, metadata = {}, occurredAt, dedupeKey = null, context = {} }) {
  const resolvedActorType = actorType || (userId ? 'user' : 'system');
  if (!EVENT_ACTORS.includes(resolvedActorType)) throw new AppError(400, 'INVALID_ANALYTICS_ACTOR', 'The analytics actor is invalid');
  return {
    eventId: newEventId(), eventVersion: definition.version, authority: definition.authority, actorType: resolvedActorType,
    actorId: safeId(actorId || userId), userId: safeId(userId), anonymousSessionId: userId ? null : (anonymousSessionId || null),
    businessId: safeId(context.businessId), locationId: safeId(context.locationId), categoryIds: (context.categoryIds || []).filter(safeId).slice(0, 20),
    eventName, entityType, entityId: safeId(entityId), source: EVENT_SOURCES.includes(source) ? source : 'SYSTEM', placement: placement || null,
    platform: EVENT_PLATFORMS.includes(platform) ? platform : 'server', appVersion: appVersion || null, sessionId: sessionId || anonymousSessionId || null,
    attribution: sanitizeMetadata(attribution, ['source', 'campaign', 'medium']), metadata, properties: metadata,
    occurredAt: clampDate(occurredAt), receivedAt: new Date(), dedupeKey: dedupeKey || undefined, retentionClass: definition.retentionClass
  };
}

async function recordClientEvent(userId, input = {}) {
  const eventName = normalizeEventName(input.eventName);
  const definition = getEventDefinition(eventName);
  if (!definition || !definition.clientAllowed) throw new AppError(400, 'CLIENT_EVENT_NOT_ALLOWED', 'This event can only be emitted by a trusted server domain');
  const sessionId = input.sessionId || input.anonymousSessionId || null;
  if (!userId && !sessionId) throw new AppError(400, 'ANALYTICS_IDENTITY_REQUIRED', 'Anonymous analytics events require a session identifier');
  const context = await resolveEntityContext(input.entityType, input.entityId);
  const metadata = sanitizeMetadata({ ...(input.properties || {}), ...(input.metadata || {}) }, definition.allowedMetadataKeys);
  const dedupeKey = input.clientEventId ? `client:${userId || sessionId}:${input.clientEventId}` : null;
  const document = buildDocument({ definition, eventName, userId, actorType: userId ? 'user' : 'anonymous', actorId: userId, anonymousSessionId: sessionId, sessionId, entityType: input.entityType, entityId: input.entityId, source: input.source || 'APP', placement: input.placement, platform: input.platform || 'server', appVersion: input.appVersion, attribution: input.attribution, metadata, occurredAt: input.occurredAt, dedupeKey, context });
  try {
    const saved = await AnalyticsEvent.create(document);
    await touchSession({ sessionId, userId, platform: document.platform, appVersion: document.appVersion, occurredAt: document.occurredAt });
    return { accepted: true, duplicate: false, eventId: saved.eventId };
  } catch (error) {
    if (error?.code === 11000 && dedupeKey) return { accepted: false, duplicate: true };
    throw error;
  }
}

async function recordClientEvents(userId, events = []) {
  if (!Array.isArray(events) || events.length > 50) throw new AppError(400, 'ANALYTICS_BATCH_TOO_LARGE', 'Analytics batches are limited to 50 events');
  const results = [];
  for (const event of events) results.push(await recordClientEvent(userId, event));
  return results;
}

async function recordAuthoritativeEvent(eventNameInput, context = {}) {
  const eventName = normalizeEventName(eventNameInput);
  const definition = getEventDefinition(eventName);
  if (!definition || definition.authority === EVENT_AUTHORITIES.CLIENT) throw new AppError(400, 'INVALID_SERVER_EVENT', 'This event is not a server-authoritative event');
  const metadata = sanitizeMetadata(context.metadata || context.properties || {}, definition.allowedMetadataKeys);
  const document = buildDocument({ definition, eventName, userId: context.userId, actorType: context.actorType || 'system', actorId: context.actorId, sessionId: context.sessionId, entityType: context.entityType, entityId: context.entityId, source: context.source || 'SYSTEM', placement: context.placement, platform: context.platform || 'server', appVersion: context.appVersion, attribution: context.attribution, metadata, occurredAt: context.occurredAt, dedupeKey: context.dedupeKey, context });
  try {
    const saved = await AnalyticsEvent.create(document);
    return { accepted: true, duplicate: false, eventId: saved.eventId };
  } catch (error) {
    if (error?.code === 11000 && context.dedupeKey) return { accepted: false, duplicate: true };
    throw error;
  }
}

async function recordEvent(userId, event) { return recordClientEvent(userId, event); }
async function recordEvents(userId, events) { return recordClientEvents(userId, events); }
function normalizeEvent(userId, event = {}) { return { userId: userId || null, anonymousSessionId: userId ? null : event.anonymousSessionId || event.sessionId || null, eventName: normalizeEventName(event.eventName), entityType: event.entityType || null, entityId: event.entityId || null, properties: event.properties || event.metadata || {}, occurredAt: event.occurredAt ? new Date(event.occurredAt) : new Date() }; }

module.exports = { recordEvent, recordEvents, recordClientEvent, recordClientEvents, recordAuthoritativeEvent, normalizeEvent, normalizeEventName, sanitizeMetadata, resolveEntityContext, touchSession, clampDate };
