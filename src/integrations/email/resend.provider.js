const { Resend } = require('resend');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');

let testProvider = null;

function providerNotConfigured() {
  return new AppError(503, 'EMAIL_PROVIDER_NOT_CONFIGURED', 'Transactional email is not configured');
}

function getResendClient() {
  if (!env.emailEnabled || !env.resendApiKey) throw providerNotConfigured();
  return new Resend(env.resendApiKey);
}

async function sendEmail(params) {
  if (testProvider?.send) return testProvider.send(params);
  const client = getResendClient();
  const { idempotencyKey, ...emailPayload } = params;
  const result = await client.emails.send(emailPayload, {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal: AbortSignal.timeout(15_000)
  });
  if (result?.error) {
    const error = new Error(result.error.message || 'Email provider rejected the message');
    error.code = result.error.name || 'EMAIL_PROVIDER_ERROR';
    throw error;
  }
  return result.data;
}

async function verifyWebhook({ payload, headers }) {
  if (testProvider?.verifyWebhook) return testProvider.verifyWebhook({ payload, headers });
  if (!env.resendWebhookSecret) throw new AppError(503, 'EMAIL_WEBHOOK_NOT_CONFIGURED', 'Email webhook verification is not configured');
  const client = getResendClient();
  try {
    return client.webhooks.verify({
      payload: Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload),
      headers: {
        id: headers.id,
        timestamp: headers.timestamp,
        signature: headers.signature
      },
      webhookSecret: env.resendWebhookSecret
    });
  } catch (_error) {
    throw new AppError(400, 'EMAIL_WEBHOOK_SIGNATURE_INVALID', 'Invalid email webhook signature');
  }
}

function setEmailProviderForTests(provider) {
  testProvider = provider;
}

function resetEmailProviderForTests() {
  testProvider = null;
}

module.exports = { sendEmail, verifyWebhook, setEmailProviderForTests, resetEmailProviderForTests, providerNotConfigured };
