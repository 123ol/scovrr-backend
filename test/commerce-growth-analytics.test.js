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
const recommendationService = require('../src/modules/analytics/recommendation.service');
const businessAnalyticsService = require('../src/modules/analytics/business-analytics.service');
const platformAnalyticsService = require('../src/modules/analytics/platform-analytics.service');
const rankingExperiment = require('../src/modules/analytics/ranking-experiment');
const { profileWriteSchema, customerDirectoryExportSchema } = require('../src/modules/analytics/business-analytics.validation');

test('analytics registry separates client behavior from server authority', () => {
  assert.ok(CLIENT_EVENT_NAMES.includes('PRODUCT_VIEWED'));
  assert.ok(CLIENT_EVENT_NAMES.includes('PRODUCT_IMPRESSION'));
  assert.ok(CLIENT_EVENT_NAMES.includes('CONTENT_POST_VIEWED'));
  assert.ok(SERVER_EVENT_NAMES.includes('ORDER_PAID'));
  assert.equal(getEventDefinition('purchase').clientAllowed, false);
  assert.equal(normalizeEventName('product_view'), 'PRODUCT_VIEWED');
  assert.equal(normalizeEventName('SEARCH_PERFORMED'), 'SEARCH_PERFORMED');
});

test('nearby discovery telemetry accepts bounded location context without coordinates', () => {
  const result = createEventSchema.safeParse({ body: { eventName: 'DISCOVER_VIEWED', sessionId: 'session-12345', source: 'NEAR_YOU', placement: 'nearby_businesses', metadata: { radiusKm: 25, resultCount: 12, locationType: 'saved_coordinates' } }, params: {}, query: {} });
  assert.equal(result.success, true);
  assert.equal(Object.hasOwn(result.data.body.metadata, 'latitude'), false);
  assert.equal(Object.hasOwn(result.data.body.metadata, 'longitude'), false);
});

test('recommendation contracts expose bounded personalized and co-purchase boundaries', () => {
  assert.equal(typeof recommendationService.getPersonalizedRecommendations, 'function');
  assert.equal(typeof recommendationService.frequentlyBoughtTogether, 'function');
  const categoryId = new mongoose.Types.ObjectId();
  const businessId = new mongoose.Types.ObjectId();
  const score = recommendationService.scoreRecommendation({ categoryId, businessId, tags: ['Linen'], ratingAverage: 4.5, publishedAt: new Date() }, { categoryIds: new Set([categoryId.toString()]), businessIds: new Set([businessId.toString()]), tags: new Set(['linen']) });
  assert.ok(score > 15);
});

test('ranking experiments assign stable bounded variants without user identifiers in the response contract', () => {
  const first = rankingExperiment.assignRankingVariant({ subjectId: 'user-123' });
  const second = rankingExperiment.assignRankingVariant({ subjectId: 'user-123' });
  assert.deepEqual(first, second);
  assert.ok(['control', 'behavioral'].includes(first.variant));
  assert.equal(first.key, 'recommendation_ranking_v1');
  assert.equal(rankingExperiment.assignRankingVariant({ subjectId: null }), null);
});

test('business analytics exposes a response-time measurement boundary', () => {
  assert.equal(typeof businessAnalyticsService.getResponseTime, 'function');
  assert.equal(typeof businessAnalyticsService.getCustomerSegments, 'function');
  assert.equal(typeof businessAnalyticsService.getCustomerDirectory, 'function');
  assert.equal(typeof businessAnalyticsService.customerDirectoryCsv, 'function');
  assert.equal(typeof businessAnalyticsService.getStaffProductivity, 'function');
  assert.equal(typeof businessAnalyticsService.getCustomerProfile, 'function');
  assert.equal(typeof businessAnalyticsService.updateCustomerProfile, 'function');
  assert.equal(profileWriteSchema.safeParse({ params: { businessId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012' }, body: { tags: ['vip'], note: 'Follow up', nextFollowUpAt: '2026-10-20T09:00:00.000Z' }, query: {} }).success, true);
  assert.equal(profileWriteSchema.safeParse({ params: { businessId: '507f1f77bcf86cd799439011', customerId: '507f1f77bcf86cd799439012' }, body: { tags: Array.from({ length: 11 }, () => 'tag') }, query: {} }).success, false);
  assert.equal(customerDirectoryExportSchema.safeParse({ params: { businessId: '507f1f77bcf86cd799439011' }, query: {}, body: {} }).success, true);
  const csv = businessAnalyticsService.customerDirectoryCsv([{ id: 'customer-1', firstName: 'Ada', lastName: 'Lagos, Jr', email: 'ada@example.test', phone: '+2348000000000', orders: 2, bookings: 1, lastActivity: '2026-10-18T10:00:00.000Z', spendByCurrency: { NGN: 5000 } }]);
  assert.match(csv, /customer_id,first_name,last_name/);
  assert.match(csv, /"Lagos, Jr"/);
  assert.match(csv, /"\{""NGN"":5000\}"/);
});

test('staff productivity aggregates paid bookings by professional and currency', () => {
  const firstStaffId = new mongoose.Types.ObjectId();
  const secondStaffId = new mongoose.Types.ObjectId();
  const rows = [
    { _id: { staffUserId: firstStaffId, currency: 'NGN' }, bookings: 2, completedBookings: 1, scheduledMinutes: 91.4, lastBookingAt: new Date('2026-10-18T10:00:00Z'), paidRevenueMinor: 12_000 },
    { _id: { staffUserId: firstStaffId, currency: 'USD' }, bookings: 1, completedBookings: 1, scheduledMinutes: 30, lastBookingAt: new Date('2026-10-17T10:00:00Z'), paidRevenueMinor: 25 },
    { _id: { staffUserId: secondStaffId, currency: 'NGN' }, bookings: 1, completedBookings: 0, scheduledMinutes: 45, lastBookingAt: new Date('2026-10-16T10:00:00Z'), paidRevenueMinor: 4_000 }
  ];
  const staff = businessAnalyticsService.summarizeStaffProductivity({
    members: [
      { role: 'professional', userId: { _id: firstStaffId, firstName: 'Ada', lastName: 'Lagos', email: 'ada@example.test' } },
      { role: 'professional', userId: { _id: secondStaffId, firstName: 'Bayo', lastName: 'Ikeja', email: 'bayo@example.test' } },
      { role: 'manager', userId: { _id: new mongoose.Types.ObjectId(), firstName: 'No', lastName: 'Bookings', email: 'no@example.test' } }
    ],
    rows
  });
  assert.equal(staff.length, 3);
  assert.equal(staff[0].bookings, 3);
  assert.equal(staff[0].completedBookings, 2);
  assert.equal(staff[0].scheduledMinutes, 121);
  assert.equal(staff[0].completionRate, 0.6667);
  assert.deepEqual(staff[0].revenueByCurrency, { NGN: 12000, USD: 25 });
  assert.equal(staff[1].completionRate, 0);
  assert.equal(staff[2].bookings, 0);
});

test('platform analytics exposes a bounded state and city coverage report', () => {
  assert.equal(typeof platformAnalyticsService.getGeographyReport, 'function');
  assert.equal(typeof platformAnalyticsService.getServicesReport, 'function');
  assert.equal(typeof platformAnalyticsService.getRevenueReport, 'function');
  assert.equal(typeof platformAnalyticsService.getSellerGrowthReport, 'function');
  assert.equal(typeof platformAnalyticsService.getLogisticsReport, 'function');
  assert.equal(typeof platformAnalyticsService.getEventQualityReport, 'function');
  assert.equal(typeof platformAnalyticsService.getRetentionReport, 'function');
  assert.equal(typeof platformAnalyticsService.getConversionReport, 'function');
  assert.equal(typeof platformAnalyticsService.getFinancialRiskReport, 'function');
  assert.equal(typeof platformAnalyticsService.getReconciliationAlerts, 'function');
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

test('customer segment summary merges order and booking activity without combining currencies', () => {
  const customerA = new mongoose.Types.ObjectId();
  const customerB = new mongoose.Types.ObjectId();
  const summary = businessAnalyticsService.summarizeCustomerSegments({
    orders: [{ _id: customerA, purchases: 1, spendMinor: 1000 }, { _id: customerB, purchases: 1, spendMinor: 500 }],
    bookings: [{ _id: customerA, purchases: 1, spendMinor: 2000 }],
    base: { range: { label: '30d' }, total: 2, newCustomers: 1, returningCustomers: 1 }
  });
  assert.deepEqual(summary.segments, { newCustomers: 1, returningCustomers: 1, repeatInRange: 1, highValueTopQuartile: 1 });
});
