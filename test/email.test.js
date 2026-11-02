const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const { TEMPLATE_DEFINITIONS, renderEmailTemplate, escapeHtml } = require('../src/modules/email/email.templates');
const { generateOtp, hashOtp, matchesOtp, OTP_TTL_MS, RESEND_COOLDOWN_MS, MAX_ATTEMPTS } = require('../src/modules/auth/email-verification.service');
const { EmailDelivery } = require('../src/modules/email/email-delivery.model');
const { EmailVerificationChallenge } = require('../src/modules/auth/email-verification.model');
const resendProvider = require('../src/integrations/email/resend.provider');

test('all approved email templates render branded HTML and plain text', () => {
  const requiredTemplates = [
    'email_verification_otp', 'welcome', 'password_reset', 'password_changed', 'email_changed', 'security_alert',
    'seller_application_received', 'seller_activated', 'business_verification_approved', 'business_verification_rejected',
    'payout_successful', 'payout_failed', 'order_confirmation', 'order_shipped', 'order_delivered', 'order_cancelled',
    'payment_receipt', 'booking_confirmation', 'booking_reminder', 'booking_cancelled', 'new_seller_review', 'platform_announcement'
  ];
  for (const templateKey of requiredTemplates) {
    const rendered = renderEmailTemplate(templateKey, { firstName: 'Ayo', otp: '123456', details: 'A safe update', ctaLabel: 'Open SCOVRR', ctaUrl: 'https://scovrr.com' });
    assert.ok(rendered.subject);
    assert.match(rendered.html, /SCOVRR/);
    assert.match(rendered.text, /SCOVRR/);
    assert.equal(rendered.category, TEMPLATE_DEFINITIONS[templateKey].category);
  }
});

test('email template values are escaped before HTML rendering', () => {
  const malicious = '<script>alert(1)</script> & "quoted"';
  const rendered = renderEmailTemplate('welcome', { firstName: malicious });
  assert.equal(escapeHtml(malicious), '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;');
  assert.equal(rendered.html.includes(malicious), false);
  assert.match(rendered.html, /&lt;script&gt;/);
});

test('OTP generation and comparison use bounded six-digit codes and a one-way hash', () => {
  const code = generateOtp();
  assert.match(code, /^\d{6}$/);
  const hash = hashOtp('Ayo@Example.com', code);
  assert.equal(hash.length, 64);
  assert.equal(matchesOtp('ayo@example.com', code, hash), true);
  assert.equal(matchesOtp('ayo@example.com', '000000', hash), false);
  assert.equal(OTP_TTL_MS, 5 * 60 * 1_000);
  assert.equal(RESEND_COOLDOWN_MS, 60 * 1_000);
  assert.equal(MAX_ATTEMPTS, 5);
});

test('email delivery and verification models protect sensitive fields and expose operational indexes', () => {
  assert.equal(EmailDelivery.schema.path('encryptedPayload.ciphertext').options.required, true);
  assert.equal(EmailDelivery.schema.path('encryptedPayload.iv').options.required, true);
  assert.equal(EmailDelivery.schema.path('encryptedPayload.authTag').options.required, true);
  assert.equal(EmailDelivery.schema.path('idempotencyKey').options.unique, true);
  assert.equal(EmailVerificationChallenge.schema.path('codeHash').options.select, false);
  assert.ok(EmailVerificationChallenge.schema.indexes().some(([fields]) => fields.expiresAt === 1));
});

test('email sending stays disabled without explicit provider configuration', async () => {
  const output = execFileSync(process.execPath, ['-e', "require('./src/modules/email/email.service').queueEmail({ toEmail: 'test@example.com', templateKey: 'welcome', idempotencyKey: 'test-email-disabled' }).then((result) => process.stdout.write(JSON.stringify(result))).catch((error) => { process.stderr.write(error.stack); process.exit(1); });"], { cwd: process.cwd(), env: { ...process.env, EMAIL_ENABLED: 'false' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output), { queued: false, reason: 'EMAIL_DISABLED' });
});

test('Resend adapter can be mocked without network access', async () => {
  let sent;
  resendProvider.setEmailProviderForTests({
    send: async (params) => { sent = params; return { id: 'mock-message-id' }; },
    verifyWebhook: async ({ payload, headers }) => ({ id: headers.id, type: 'email.delivered', data: { email_id: payload } })
  });
  const result = await resendProvider.sendEmail({ to: ['test@example.com'], subject: 'Test', html: '<p>Test</p>', text: 'Test', idempotencyKey: 'mock-key' });
  assert.equal(result.id, 'mock-message-id');
  assert.deepEqual(sent.to, ['test@example.com']);
  const event = await resendProvider.verifyWebhook({ payload: 'provider-message-id', headers: { id: 'provider-event-id', timestamp: '1', signature: 'mock' } });
  assert.equal(event.type, 'email.delivered');
  resendProvider.resetEmailProviderForTests();
});
