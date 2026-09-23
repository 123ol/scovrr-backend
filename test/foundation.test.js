const assert = require('node:assert/strict');
const test = require('node:test');
const { createOpaqueToken, hashToken } = require('../src/common/security/tokens');
const { registerSchema, profileUpdateSchema } = require('../src/modules/auth/auth.validation');
const { validate } = require('../src/common/validation/validate');
const { sendSuccess } = require('../src/common/http/response');

test('registration schema rejects invalid input with field-level issues', () => {
  const result = registerSchema.safeParse({
    body: { firstName: '', lastName: 'User', email: 'not-an-email', password: 'short' },
    params: {},
    query: {}
  });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path.join('.') === 'body.email'));
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
