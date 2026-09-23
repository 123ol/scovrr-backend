const assert = require('node:assert/strict');
const test = require('node:test');
const { CatalogueUploadSession } = require('../src/modules/media/catalogue-upload-session.model');
const { ContentPost } = require('../src/modules/content-posts/content-post.model');
const { CatalogueMediaAsset } = require('../src/modules/media/catalogue-media-asset.model');
const { Payment } = require('../src/modules/payments/payment.model');
const { assertPublishableCatalogueMedia } = require('../src/modules/media/catalogue-media.service');
const { INDEX_DEFINITIONS, sameOptions } = require('../scripts/migrate-launch-indexes');
const { comparePayment } = require('../src/modules/reconciliation/reconciliation.service');

test('catalogue upload sessions expire and content moderation has operational indexes', () => {
  assert.ok(CatalogueUploadSession.schema.indexes().some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  assert.ok(ContentPost.schema.indexes().some(([fields]) => fields.businessId === 1 && fields.status === 1 && fields.createdAt === -1));
  assert.ok(ContentPost.schema.indexes().some(([fields]) => fields.status === 1 && fields.moderationStatus === 1 && fields.createdAt === -1));
  assert.ok(CatalogueMediaAsset.schema.indexes().some(([fields, options]) => fields.businessId === 1 && fields.publicId === 1 && options.unique === true));
});

test('payments keep settlement state separate from provider success', () => {
  assert.equal(Payment.schema.path('settlementStatus').defaultValue, 'pending');
  assert.ok(Payment.schema.path('settlementStatus').enumValues.includes('processing'));
  assert.ok(Payment.schema.path('settlementStatus').enumValues.includes('completed'));
  assert.equal(comparePayment({ status: 'successful', settlementStatus: 'failed', amountMinor: 100, currency: 'NGN' }, { status: 'success', amount: 100, currency: 'NGN' }).mismatchType, 'internal_settlement_missing');
});

test('launch index migration detects security-sensitive option drift', () => {
  const definition = INDEX_DEFINITIONS.find((item) => item.collection === 'orders');
  assert.equal(sameOptions({ unique: true, partialFilterExpression: { checkoutIdempotencyKey: { $type: 'string' } } }, definition.options), true);
  assert.equal(sameOptions({ unique: false, partialFilterExpression: { checkoutIdempotencyKey: { $type: 'string' } } }, definition.options), false);
});

test('catalogue items cannot be published without verified media', () => {
  assert.throws(() => assertPublishableCatalogueMedia([], 'Product'), (error) => error.code === 'MEDIA_REQUIRED');
  assert.throws(() => assertPublishableCatalogueMedia([{ url: 'http://unsafe.example/image.jpg' }], 'Product'), (error) => error.code === 'MEDIA_INVALID');
  assert.doesNotThrow(() => assertPublishableCatalogueMedia([{ url: 'https://res.cloudinary.com/example/image/upload/item.jpg' }], 'Product'));
});
