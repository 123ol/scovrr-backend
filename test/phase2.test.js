const assert = require('node:assert/strict');
const test = require('node:test');
const { slugify } = require('../src/common/slug');
const { permissionsForRole } = require('../src/modules/businesses/business-membership.model');
const { createBusinessSchema, createLocationSchema } = require('../src/modules/businesses/business.validation');
const { attachVerificationEvidenceSchema } = require('../src/modules/businesses/business.validation');
const { sessionSchema } = require('../src/modules/evidence/evidence.validation');
const { EvidenceAsset } = require('../src/modules/evidence/evidence-asset.model');
const { EvidenceUploadSession } = require('../src/modules/evidence/upload-session.model');
const { SAFE_EVIDENCE_MIME_TYPES } = require('../src/integrations/media/cloudinary.provider');
const { Business } = require('../src/modules/businesses/business.model');
const { validateCategory: validateProductCategory } = require('../src/modules/products/product.service');
const { categoryTypeCompatible } = require('../src/modules/businesses/business.service');

test('business slugs are readable and normalized', () => {
  assert.equal(slugify('  Glow & Go Studio  '), 'glow-go-studio');
  assert.equal(slugify('Amaka Beauty — Akure'), 'amaka-beauty-akure');
});

test('business role permissions are server-defined', () => {
  assert.ok(permissionsForRole('owner').includes('business.capabilities.manage'));
  assert.ok(!permissionsForRole('booking_staff').includes('finance.view'));
});

test('business creation requires unique capabilities', () => {
  const result = createBusinessSchema.safeParse({
    body: { name: 'Studio', capabilities: ['services', 'services'], categoryIds: [], operatingModel: 'home_based' },
    params: {},
    query: {}
  });
  assert.equal(result.success, false);
});

test('business creation accepts multiple category slugs', () => {
  const result = createBusinessSchema.safeParse({
    body: {
      name: 'Studio',
      capabilities: ['marketplace'],
      categoryIds: [],
      categorySlugs: ['fashion', 'beauty', 'hair'],
      operatingModel: 'home_based',
      location: { address: { city: 'Akure', state: 'Ondo', country: 'Nigeria' }, coordinates: [5.195, 7.252] }
    },
    params: {},
    query: {}
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.categorySlugs, ['fashion', 'beauty', 'hair']);
});

test('business category types map to their public business capabilities', () => {
  assert.equal(categoryTypeCompatible('product', ['marketplace']), true);
  assert.equal(categoryTypeCompatible('service', ['services']), true);
  assert.equal(categoryTypeCompatible('both', ['marketplace']), true);
  assert.equal(categoryTypeCompatible('both', ['services']), true);
  assert.equal(categoryTypeCompatible('service', ['marketplace']), false);
  assert.equal(categoryTypeCompatible('product', ['services']), false);
});

test('business creation requires the first shop location', () => {
  const base = {
    name: 'Studio',
    capabilities: ['services'],
    categoryIds: [],
    operatingModel: 'home_based'
  };

  assert.equal(createBusinessSchema.safeParse({ body: base, params: {}, query: {} }).success, false);
  assert.equal(createBusinessSchema.safeParse({
    body: {
      ...base,
      location: { address: { city: 'Akure', state: 'Ondo', country: 'Nigeria' }, coordinates: [5.195, 7.252] }
    },
    params: {},
    query: {}
  }).success, true);
});

test('location validation preserves longitude-first coordinate order', () => {
  const result = createLocationSchema.safeParse({
    body: {
      name: 'Main studio',
      address: { city: 'Akure', state: 'Ondo', country: 'Nigeria' },
      coordinates: [5.195, 7.252],
      timezone: 'Africa/Lagos',
      publiclyVisible: true,
      pickupAvailable: false,
      active: true
    },
    params: { businessId: '507f1f77bcf86cd799439011' },
    query: {}
  });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.body.coordinates, [5.195, 7.252]);
});

test('seller branch creation requires coordinates for nearby discovery', () => {
  const result = createLocationSchema.safeParse({
    body: {
      name: 'Main studio',
      address: { city: 'Akure', state: 'Ondo', country: 'Nigeria' },
      timezone: 'Africa/Lagos'
    },
    params: { businessId: '507f1f77bcf86cd799439011' },
    query: {}
  });
  assert.equal(result.success, false);
});

test('product capability is required even when no category is supplied', async () => {
  await assert.rejects(
    () => validateProductCategory(undefined, { capabilities: ['services'] }),
    (error) => error.code === 'MARKETPLACE_CAPABILITY_REQUIRED'
  );
});

test('verification evidence uses the existing private upload and business ownership boundaries', () => {
  assert.equal(EvidenceAsset.schema.path('purpose').enumValues.includes('verification'), true);
  assert.equal(EvidenceAsset.schema.path('subjectType').enumValues.includes('verification'), true);
  assert.equal(EvidenceUploadSession.schema.path('purpose').enumValues.includes('verification'), true);
  assert.equal(Business.schema.path('verification.evidenceAssetIds').instance, 'Array');
  assert.equal(Business.schema.path('verification.status').enumValues.includes('additional_information_required'), true);

  const businessId = '507f1f77bcf86cd799439011';
  assert.equal(sessionSchema.safeParse({ body: { purpose: 'verification', mimeType: 'image/jpeg', subjectType: 'business', subjectId: businessId }, params: {}, query: {} }).success, true);
  assert.equal(sessionSchema.safeParse({ body: { purpose: 'verification', mimeType: 'image/jpeg', subjectType: 'conversation', subjectId: businessId }, params: {}, query: {} }).success, false);
  assert.equal(attachVerificationEvidenceSchema.safeParse({ body: { evidenceAssetIds: [businessId] }, params: { businessId }, query: {} }).success, true);
});

test('CAC verification evidence is optional but supports a labelled PDF upload', () => {
  const businessId = '507f1f77bcf86cd799439011';
  assert.equal(SAFE_EVIDENCE_MIME_TYPES.has('application/pdf'), true);
  assert.equal(sessionSchema.safeParse({ body: { purpose: 'verification', documentType: 'cac', mimeType: 'application/pdf', subjectType: 'business', subjectId: businessId }, params: {}, query: {} }).success, true);
  assert.equal(sessionSchema.safeParse({ body: { purpose: 'report', documentType: 'cac', mimeType: 'application/pdf', subjectType: 'business', subjectId: businessId }, params: {}, query: {} }).success, false);
  assert.equal(EvidenceUploadSession.schema.path('documentType').enumValues.includes('cac'), true);
  assert.equal(EvidenceAsset.schema.path('documentType').enumValues.includes('cac'), true);
});
