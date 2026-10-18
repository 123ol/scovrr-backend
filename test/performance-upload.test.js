const assert = require('node:assert/strict');
const { test } = require('node:test');

const { databaseOptions } = require('../src/config/database');
const { mongooseIndexDefaults } = require('../src/config/env');
const { isConfigured, ensureConfigured } = require('../src/integrations/media/cloudinary.provider');

test('database connection options expose controlled index creation settings', () => {
  const options = databaseOptions();
  assert.equal(typeof options.autoIndex, 'boolean');
  assert.equal(typeof options.autoCreate, 'boolean');
  assert.equal(typeof options.serverSelectionTimeoutMS, 'number');
});

test('production defaults are represented as explicit boolean database options', () => {
  assert.deepEqual(mongooseIndexDefaults('production'), { autoIndex: false, autoCreate: false });
  assert.deepEqual(mongooseIndexDefaults('test'), { autoIndex: true, autoCreate: true });
  assert.equal(typeof databaseOptions().autoIndex, 'boolean');
  assert.equal(typeof databaseOptions().autoCreate, 'boolean');
});

test('catalogue upload provider fails clearly when Cloudinary is unavailable', () => {
  assert.equal(isConfigured({ mediaProvider: '', cloudinaryCloudName: '', cloudinaryApiKey: '', cloudinaryApiSecret: '' }), false);
  assert.throws(() => ensureConfigured({ mediaProvider: 'cloudinary', cloudinaryCloudName: '', cloudinaryApiKey: '', cloudinaryApiSecret: '' }), (error) => error.code === 'MEDIA_PROVIDER_NOT_CONFIGURED' && error.statusCode === 503);
});

test('catalogue upload provider recognizes complete Cloudinary configuration', () => {
  assert.equal(isConfigured({ mediaProvider: 'cloudinary', cloudinaryCloudName: 'test-cloud', cloudinaryApiKey: 'test-key', cloudinaryApiSecret: 'test-secret' }), true);
});
