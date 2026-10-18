const assert = require('node:assert/strict');
const test = require('node:test');
const { createOpaqueToken, hashToken } = require('../src/common/security/tokens');
const { registerSchema, profileUpdateSchema, privacyConsentSchema } = require('../src/modules/auth/auth.validation');
const { validate } = require('../src/common/validation/validate');
const { sendSuccess } = require('../src/common/http/response');
const authService = require('../src/modules/auth/auth.service');
const { User } = require('../src/modules/users/user.model');
const { normalizePhone } = require('../src/common/phone');
const { isPublicReadPath, shouldCachePublicResponse } = require('../src/common/http/public-cache');

test('registration schema rejects invalid input with field-level issues', () => {
  const result = registerSchema.safeParse({
    body: { firstName: '', lastName: 'User', email: 'not-an-email', password: 'short' },
    params: {},
    query: {}
  });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path.join('.') === 'body.email'));
});

test('seller registration requires a saved location while buyer registration does not', () => {
  const base = { firstName: 'Zina', lastName: 'User', email: 'zina@example.com', password: 'password123' };
  assert.equal(registerSchema.safeParse({ body: { ...base, accountType: 'buyer' }, params: {}, query: {} }).success, true);
  assert.equal(registerSchema.safeParse({ body: { ...base, accountType: 'seller' }, params: {}, query: {} }).success, false);
  assert.equal(registerSchema.safeParse({
    body: {
      ...base,
      accountType: 'seller',
      location: { coordinates: [5.195, 7.252], city: 'Akure', state: 'Ondo', country: 'Nigeria', capturedAt: '2026-09-23T10:00:00.000Z' }
    },
    params: {},
    query: {}
  }).success, true);
});

test('validation middleware applies normalized request data before the controller', () => {
  const req = {
    body: { firstName: 'Zina', lastName: 'Adebayo', email: 'ZINA@EXAMPLE.COM', password: 'long-enough-password' },
    params: {},
    query: {}
  };
  let nextError;
  validate(registerSchema)(req, {}, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(req.body.email, 'zina@example.com');
});

test('success responses use the documented envelope', () => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  sendSuccess(response, { id: 'example' }, { requestId: 'test' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true, data: { id: 'example' }, meta: { requestId: 'test' } });
});

test('refresh token hashes are one-way and opaque tokens are unique', () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();
  assert.notEqual(first, second);
  assert.notEqual(hashToken(first), first);
  assert.equal(hashToken(first).length, 64);
});

test('profile updates are bounded and cannot be empty', () => {
  assert.equal(profileUpdateSchema.safeParse({ body: { firstName: 'Ada', phone: null }, params: {}, query: {} }).success, true);
  assert.equal(profileUpdateSchema.safeParse({ body: {}, params: {}, query: {} }).success, false);
});

test('privacy consent is versioned and cannot be recorded as an implicit or unsupported acceptance', () => {
  assert.equal(privacyConsentSchema.safeParse({ body: { accepted: true, policyVersion: 'v1' }, params: {}, query: {} }).success, true);
  assert.equal(privacyConsentSchema.safeParse({ body: { accepted: false, policyVersion: 'v1' }, params: {}, query: {} }).success, false);
  assert.equal(privacyConsentSchema.safeParse({ body: { accepted: true, policyVersion: '' }, params: {}, query: {} }).success, false);
  assert.match(authService.recordPrivacyConsent.toString(), /privacyPolicyVersion/);
  assert.match(authService.getPrivacyConsent.toString(), /currentPolicyVersion/);
  const user = new User({ firstName: 'Ada', lastName: 'User', email: 'privacy@example.test', passwordHash: 'hash', privacyConsent: { policyVersion: 'v1', acceptedAt: new Date('2026-10-18T00:00:00.000Z'), source: 'settings' } });
  assert.deepEqual(user.toSafeJSON().privacyConsent, { policyVersion: 'v1', acceptedAt: new Date('2026-10-18T00:00:00.000Z') });
});

test('Nigerian phone inputs normalize to E.164 while international values remain supported', () => {
  assert.equal(normalizePhone('0803 123 4567'), '+2348031234567');
  assert.equal(normalizePhone('+234 803 123 4567'), '+2348031234567');
  assert.equal(normalizePhone('+447911123456'), '+447911123456');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(registerSchema.safeParse({ body: { firstName: 'Zina', lastName: 'User', email: 'phone@example.com', password: 'password123', phone: '0803 123 4567' }, params: {}, query: {} }).data.body.phone, '+2348031234567');
});

test('public cache boundary excludes authenticated and private reads', () => {
  assert.equal(isPublicReadPath('/api/v1/products/blue-dress'), true);
  assert.equal(isPublicReadPath('/api/v1/businesses/mine'), false);
  assert.equal(shouldCachePublicResponse({ method: 'GET', path: '/api/v1/products/blue-dress', get: () => undefined }), true);
  assert.equal(shouldCachePublicResponse({ method: 'GET', path: '/api/v1/products/blue-dress', get: () => 'Bearer token' }), false);
});

test('login keeps new-device security notification non-blocking', () => {
  assert.match(authService.login.toString(), /security_new_login/);
  assert.match(authService.login.toString(), /knownDevice/);
});
