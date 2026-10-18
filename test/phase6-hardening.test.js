const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { User } = require('../src/modules/users/user.model');
const { assertUserCanAct } = require('../src/modules/users/user-status.service');
const { EvidenceAsset } = require('../src/modules/evidence/evidence-asset.model');
const { EvidenceUploadSession } = require('../src/modules/evidence/upload-session.model');
const { Dispute } = require('../src/modules/disputes/dispute.model');
const { Review } = require('../src/modules/reviews/review.model');
const { ADMIN_PERMISSIONS, hasAdminPermission } = require('../src/modules/admin/admin-permissions');
const { getEvidenceRetentionPolicy, retentionExpiry, cleanupExpiredEvidence } = require('../src/modules/evidence/evidence.service');

test('user suspension is a first-class status and blocks user actions', () => {
  assert.equal(User.schema.path('status').enumValues.includes('suspended'), true);
  assert.throws(() => assertUserCanAct({ status: 'suspended' }), (error) => error.code === 'ACCOUNT_SUSPENDED');
  assert.doesNotThrow(() => assertUserCanAct({ status: 'active' }));
  assert.equal(hasAdminPermission(['operations'], ADMIN_PERMISSIONS.USERS_SUSPEND), true);
  assert.equal(hasAdminPermission(['moderator'], ADMIN_PERMISSIONS.USERS_SUSPEND), false);
});

test('evidence uses expiring sessions and never serializes provider credentials', () => {
  assert.equal(EvidenceUploadSession.schema.path('expiresAt').instance, 'Date');
  assert.ok(EvidenceUploadSession.schema.indexes().some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  const asset = new EvidenceAsset({ _id: new mongoose.Types.ObjectId(), sessionId: new mongoose.Types.ObjectId(), uploadedBy: new mongoose.Types.ObjectId(), purpose: 'report', provider: 'cloudinary', providerAssetId: 'private-provider-id', storageKey: 'private-storage-key', type: 'image', mimeType: 'image/jpeg', sizeBytes: 100, visibility: 'parties' });
  const safe = asset.toSafeJSON();
  assert.equal(safe.providerAssetId, undefined);
  assert.equal(safe.storageKey, undefined);
});

test('evidence retention is disabled by default and cleanup is safe until policy is configured', async () => {
  assert.equal(EvidenceAsset.schema.path('retentionExpiresAt').instance, 'Date');
  const policy = getEvidenceRetentionPolicy();
  assert.equal(policy.automaticRetentionEnabled, false);
  assert.equal(policy.retentionDays, null);
  assert.equal(retentionExpiry(), null);
  assert.deepEqual(await cleanupExpiredEvidence(), { cleaned: 0, skipped: true });
});

test('customer and business dispute serializers omit internal financial and admin controls', () => {
  const dispute = new Dispute({ _id: new mongoose.Types.ObjectId(), disputeNumber: 'SCV-DSP-TEST', customerId: new mongoose.Types.ObjectId(), businessId: new mongoose.Types.ObjectId(), targetType: 'order', transactionType: 'order', orderId: new mongoose.Types.ObjectId(), reason: 'fraud', description: 'A detailed dispute description', disputedAmountMinor: 1000, currency: 'NGN', assignedAdminId: new mongoose.Types.ObjectId(), payoutId: new mongoose.Types.ObjectId(), financialState: 'recovery_required', financialHold: true, adminDecision: { outcome: 'other', note: 'private' }, timeline: [{ status: 'open', actorId: new mongoose.Types.ObjectId(), note: 'opened' }] });
  const safe = dispute.toSafeJSON({ audience: 'customer' });
  assert.equal(safe.assignedAdminId, undefined);
  assert.equal(safe.payoutId, undefined);
  assert.equal(safe.financialState, undefined);
  assert.equal(safe.adminDecision, undefined);
  assert.equal(safe.timeline[0].actorId, undefined);
  assert.equal(dispute.toSafeJSON({ audience: 'admin' }).financialState, 'recovery_required');
});

test('public review serialization does not expose reviewer identity', () => {
  const review = new Review({ _id: new mongoose.Types.ObjectId(), reviewerId: new mongoose.Types.ObjectId(), targetType: 'product', productId: new mongoose.Types.ObjectId(), businessId: new mongoose.Types.ObjectId(), rating: 5, text: 'Great', status: 'approved' });
  assert.equal(review.toSafeJSON().reviewerId, undefined);
  assert.equal(review.toSafeJSON({ audience: 'admin' }).reviewerId, review.reviewerId.toString());
});
