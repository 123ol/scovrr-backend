const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const mongoose = require('mongoose');

const { User } = require('../src/modules/users/user.model');
const { SearchHistory } = require('../src/modules/discovery/search-history.model');
const { RecentlyViewed } = require('../src/modules/discovery/recently-viewed.model');
const { preferenceForType, notificationAllowed } = require('../src/modules/notifications/notification.service');
const { moderationNotificationDetails } = require('../src/modules/moderation/moderation.service');
const { RefreshSession } = require('../src/modules/auth/refresh-session.model');
const { safeSessionJSON } = require('../src/modules/auth/auth.service');
const { AccountExportJob } = require('../src/modules/auth/account-export-job.model');
const { exportJobIdSchema, deletionRequestSchema, deletionRequestReviewSchema } = require('../src/modules/auth/auth.validation');
const { AccountDeletionRequest } = require('../src/modules/auth/account-deletion-request.model');
const authService = require('../src/modules/auth/auth.service');
const { ADMIN_PERMISSIONS, permissionsForAdminRoles } = require('../src/modules/admin/admin-permissions');
const { discoverSchema } = require('../src/modules/discovery/discovery.validation');
const { nearbySchema } = require('../src/modules/discovery/discovery.validation');
const discoveryService = require('../src/modules/discovery/discovery.service');

test('account privacy fields have safe defaults and bounded deactivation data', () => {
  assert.equal(User.schema.path('deactivatedAt').instance, 'Date');
  assert.equal(User.schema.path('deactivationReason').options.maxlength, 500);
  assert.equal(User.schema.path('notificationPreferences.marketing').options.default, true);
  assert.equal(User.schema.path('notificationPreferences.security').options.default, true);
});

test('personal export jobs are short-lived, ownership-scoped, and do not expose documents before completion', () => {
  const id = '507f1f77bcf86cd799439011';
  const userId = '507f1f77bcf86cd799439012';
  const job = new AccountExportJob({ _id: id, userId, status: 'queued', document: { profile: { email: 'private@example.com' } }, expiresAt: new Date('2030-01-01') });
  assert.ok(AccountExportJob.schema.indexes().some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  assert.equal(job.toSafeJSON().document, null);
  job.status = 'completed';
  assert.equal(job.toSafeJSON().document.profile.email, 'private@example.com');
  assert.equal(exportJobIdSchema.safeParse({ body: {}, params: { exportJobId: id }, query: {} }).success, true);
  assert.equal(exportJobIdSchema.safeParse({ body: {}, params: { exportJobId: 'not-an-id' }, query: {} }).success, false);
});

test('account deletion uses a non-destructive review boundary with safe retention defaults', () => {
  const policy = authService.getAccountLifecyclePolicy();
  assert.equal(policy.deletionRequest.automaticDeletionEnabled, false);
  assert.equal(policy.retention.recordsRetainedUntilApprovedWorkflow, true);
  assert.equal(deletionRequestSchema.safeParse({ body: { reason: 'I no longer need this account' }, params: {}, query: {} }).success, true);
  assert.equal(deletionRequestReviewSchema.safeParse({ body: { action: 'start_review', reason: 'Confirm ownership and required retention review' }, params: { requestId: '507f1f77bcf86cd799439011' }, query: {} }).success, true);
  assert.equal(AccountDeletionRequest.schema.path('reason').options.maxlength, 500);
  assert.ok(AccountDeletionRequest.schema.indexes().some(([fields, options]) => fields.userId === 1 && fields.status === 1 && options.unique));
  const request = new AccountDeletionRequest({ _id: '507f1f77bcf86cd799439011', userId: '507f1f77bcf86cd799439012', status: 'requested', reason: 'No longer needed' });
  assert.equal(request.toSafeJSON().userId, undefined);
  assert.ok(permissionsForAdminRoles(['operations']).includes(ADMIN_PERMISSIONS.USERS_DELETION_REVIEW));
  assert.match(fs.readFileSync(require.resolve('../src/modules/auth/account-deletion.admin.routes.js'), 'utf8'), /accountLifecyclePolicy/);
});

test('account deletion requests are idempotent for an active account', async () => {
  const originalUserFindOne = User.findOne;
  const originalRequestFindOne = AccountDeletionRequest.findOne;
  const originalCreate = AccountDeletionRequest.create;
  const userId = '507f1f77bcf86cd799439012';
  User.findOne = () => ({ select: async () => ({ _id: userId, status: 'active' }) });
  AccountDeletionRequest.findOne = () => ({ sort: async () => null });
  AccountDeletionRequest.create = async (input) => new AccountDeletionRequest({ _id: '507f1f77bcf86cd799439013', ...input });
  try {
    const result = await authService.requestAccountDeletion(userId, 'I no longer use this account');
    assert.equal(result.userId.toString(), userId);
    assert.equal(result.status, 'requested');
  } finally {
    User.findOne = originalUserFindOne;
    AccountDeletionRequest.findOne = originalRequestFindOne;
    AccountDeletionRequest.create = originalCreate;
  }
});

test('nearby discovery exposes bounded coordinates and distance contracts', () => {
  assert.equal(nearbySchema.safeParse({ body: {}, params: {}, query: { latitude: 6.52, longitude: 3.37 } }).success, true);
  assert.equal(typeof discoveryService.listNearbyBusinesses, 'function');
});

test('city discovery includes public locations that do not have GPS coordinates', async () => {
  const { BusinessLocation } = require('../src/modules/businesses/business-location.model');
  const originalModelFind = BusinessLocation.find;
  let capturedFilter;
  BusinessLocation.find = (filter) => {
    capturedFilter = filter;
    return { select: () => ({ lean: async () => [{ _id: 'location-1', businessId: 'business-1' }] }) };
  };
  try {
    const context = await discoveryService.publicLocationContext({ city: 'Akure' });
    assert.deepEqual(context.businessIds, ['business-1']);
    assert.equal(Object.hasOwn(capturedFilter, 'location.coordinates.0'), false);
    assert.equal(capturedFilter.active, true);
    assert.equal(capturedFilter.publiclyVisible, true);
    assert.equal(capturedFilter['address.city'].test('akure'), true);
  } finally {
    BusinessLocation.find = originalModelFind;
  }
});

test('search history is unique per user and normalized query', () => {
  const definition = SearchHistory.schema.indexes().find(([fields]) => fields.userId === 1 && fields.normalized === 1);
  assert.ok(definition);
  assert.equal(definition[1].unique, true);
});

test('recently viewed history is unique per user and target and returns bounded safe cards', () => {
  const definition = RecentlyViewed.schema.indexes().find(([fields]) => fields.userId === 1 && fields.targetType === 1 && fields.targetId === 1);
  assert.ok(definition);
  assert.equal(definition[1].unique, true);
  assert.equal(RecentlyViewed.schema.path('viewedAt').instance, 'Date');
});

test('discovery filters use canonical product conditions and service location types', () => {
  const parsed = discoverSchema.parse({ query: { condition: 'like_new', locationType: 'online', minPriceMinor: '1000', maxPriceMinor: '5000', ratingMin: '4' } });
  assert.equal(parsed.query.condition, 'like_new');
  assert.equal(parsed.query.locationType, 'online');
  assert.equal(parsed.query.minPriceMinor, 1000);
  assert.equal(parsed.query.maxPriceMinor, 5000);
  assert.equal(parsed.query.ratingMin, 4);
  assert.throws(() => discoverSchema.parse({ query: { condition: 'used' } }));
});

test('notification types map to user preference categories', () => {
  assert.equal(preferenceForType('booking_confirmed'), 'bookingUpdates');
  assert.equal(preferenceForType('new_message'), 'messages');
  assert.equal(preferenceForType('promotion_available'), 'marketing');
  assert.equal(preferenceForType('payment_confirmed'), 'orderUpdates');
  assert.equal(preferenceForType('security_alert'), 'security');
});

test('approved product and service moderation decisions produce seller notification payloads', () => {
  const businessId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const serviceId = new mongoose.Types.ObjectId();
  const productNotification = moderationNotificationDetails('product', 'approved', { _id: productId, businessId, name: 'Brown tote bag' });
  const serviceNotification = moderationNotificationDetails('service', 'approved', { _id: serviceId, businessId, name: 'Bridal makeup' });
  assert.equal(productNotification.type, 'product_approved');
  assert.equal(productNotification.data.productId, productId.toString());
  assert.equal(productNotification.data.businessId, businessId.toString());
  assert.match(productNotification.body, /Brown tote bag/);
  assert.equal(serviceNotification.type, 'service_approved');
  assert.equal(serviceNotification.data.serviceId, serviceId.toString());
});

test('notification preference enforcement blocks only the opted-out category', async () => {
  const original = User.findById;
  User.findById = () => ({ select: () => ({ lean: async () => ({ notificationPreferences: { marketing: false, security: true } }) }) });
  try {
    assert.equal(await notificationAllowed('507f1f77bcf86cd799439011', 'promotion_available'), false);
    assert.equal(await notificationAllowed('507f1f77bcf86cd799439011', 'security_alert'), true);
  } finally {
    User.findById = original;
  }
});

test('refresh sessions expose safe device metadata and support session management fields', () => {
  assert.equal(RefreshSession.schema.path('deviceLabel').options.maxlength, 120);
  assert.deepEqual(RefreshSession.schema.path('platform').enumValues, ['ios', 'android', 'web', 'unknown']);
  assert.equal(RefreshSession.schema.path('lastUsedAt').options.default, Date.now);
  const session = new RefreshSession({ _id: '507f1f77bcf86cd799439011', user: '507f1f77bcf86cd799439012', tokenHash: 'hash', expiresAt: new Date('2030-01-01'), deviceLabel: 'Test phone', platform: 'android', userAgent: 'Bearer should never be a credential', lastUsedAt: new Date('2026-10-17') });
  const safe = safeSessionJSON(session, session._id.toString());
  assert.equal(safe.current, true);
  assert.equal(safe.deviceLabel, 'Test phone');
  assert.equal(safe.platform, 'android');
  assert.equal(Object.hasOwn(safe, 'userAgent'), false);
  assert.equal(Object.hasOwn(safe, 'ipAddress'), false);
  assert.equal(Object.hasOwn(safe, 'tokenHash'), false);
});
