const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { AnalyticsEvent } = require('../src/modules/analytics/analytics-event.model');
const { AnalyticsDailyAggregate } = require('../src/modules/analytics/analytics-daily-aggregate.model');
const { AnalyticsOutbox } = require('../src/modules/analytics/analytics-outbox.model');
const { AnalyticsSession } = require('../src/modules/analytics/analytics-session.model');
const { CLIENT_EVENT_NAMES, SERVER_EVENT_NAMES, getEventDefinition, normalizeEventName } = require('../src/modules/analytics/event-registry');
const { sanitizeMetadata, normalizeEvent, clampDate } = require('../src/modules/analytics/analytics.service');
const { createEventSchema, batchEventSchema } = require('../src/modules/analytics/analytics.validation');
const { parseArgs } = require('../scripts/backfill-analytics');
const { ADMIN_PERMISSIONS, hasAdminPermission } = require('../src/modules/admin/admin-permissions');
const { rebuildBehavioralProjections } = require('../src/modules/analytics/analytics-reconciliation.service');

test('analytics registry separates client behavior from server authority', () => {
  assert.ok(CLIENT_EVENT_NAMES.includes('PRODUCT_VIEWED'));
  assert.ok(SERVER_EVENT_NAMES.includes('ORDER_PAID'));
  assert.equal(getEventDefinition('purchase').clientAllowed, false);
  assert.equal(normalizeEventName('product_view'), 'PRODUCT_VIEWED');
  assert.equal(normalizeEventName('SEARCH_PERFORMED'), 'SEARCH_PERFORMED');
});

test('analytics model stores bounded context and idempotency indexes', () => {
  assert.ok(AnalyticsEvent.schema.path('eventId').options.unique);
  assert.ok(AnalyticsEvent.schema.path('dedupeKey').options.unique);
  assert.ok(AnalyticsEvent.schema.path('businessId'));
  assert.ok(AnalyticsEvent.schema.indexes().some(([fields]) => fields.businessId && fields.occurredAt));
  assert.ok(AnalyticsSession.schema.indexes().some(([fields, options]) => fields.lastActivityAt && options.expireAfterSeconds));
  assert.ok(AnalyticsOutbox.schema.indexes().some(([fields]) => fields.status && fields.nextAttemptAt));
  assert.ok(AnalyticsDailyAggregate.schema.indexes().some(([fields, options]) => fields.scope && options.unique));
});

test('client analytics contracts reject forged authoritative and unrestricted payloads', () => {
  const id = new mongoose.Types.ObjectId().toString();
  assert.equal(createEventSchema.safeParse({ body: { eventName: 'ORDER_PAID', sessionId: 'session-12345', entityType: 'order', entityId: id }, params: {}, query: {} }).success, false);
  assert.equal(batchEventSchema.safeParse({ body: { events: [{ eventName: 'PRODUCT_VIEWED', sessionId: 'session-12345', entityType: 'product', entityId: id, metadata: { password: 'should-be-rejected-by-service' } }] }, params: {}, query: {} }).success, true);
  assert.equal(createEventSchema.safeParse({ body: { eventName: 'PRODUCT_VIEWED', sessionId: 'session-12345', unknownSecret: 'nope' }, params: {}, query: {} }).success, false);
  assert.deepEqual(sanitizeMetadata({ amountMinor: 1200, password: 'secret', query: 'dress' }, ['amountMinor', 'query']), { amountMinor: 1200, query: 'dress' });
  assert.equal(normalizeEvent(null, { eventName: 'product_view', anonymousSessionId: 'session-12345' }).eventName, 'PRODUCT_VIEWED');
  assert.ok(clampDate('2036-01-01T00:00:00.000Z').getTime() <= Date.now() + 5 * 60_000);
});

test('analytics backfill is dry-run by default and bounded', () => {
  assert.deepEqual(parseArgs(['--limit', '25']), { apply: false, limit: 25, businessId: null });
  assert.deepEqual(parseArgs(['--apply', '--limit', '10', '--business', '507f1f77bcf86cd799439011']), { apply: true, limit: 10, businessId: '507f1f77bcf86cd799439011' });
});

test('analytics admin permissions are separated for platform and financial views', () => {
  assert.equal(hasAdminPermission(['operations'], ADMIN_PERMISSIONS.ANALYTICS_PLATFORM_READ), true);
  assert.equal(hasAdminPermission(['operations'], ADMIN_PERMISSIONS.ANALYTICS_FINANCIAL_READ), false);
  assert.equal(hasAdminPermission(['finance_admin'], ADMIN_PERMISSIONS.ANALYTICS_FINANCIAL_READ), true);
});

test('analytics rebuild boundary is explicit and dry-run by default', async () => {
  const report = await rebuildBehavioralProjections({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' });
  assert.equal(report.dryRun, true);
  assert.equal(report.events, null);
});
