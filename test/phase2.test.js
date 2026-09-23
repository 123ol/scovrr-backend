const assert = require('node:assert/strict');
const test = require('node:test');
const { slugify } = require('../src/common/slug');
const { permissionsForRole } = require('../src/modules/businesses/business-membership.model');
const { createBusinessSchema, createLocationSchema } = require('../src/modules/businesses/business.validation');

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

