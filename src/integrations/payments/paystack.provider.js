const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { PaymentProvider } = require('./payment-provider');

const API_URL = 'https://api.paystack.co';

class PaystackProvider extends PaymentProvider {
  constructor(secretKey = env.paystackSecretKey) {
    super();
    this.secretKey = secretKey;
  }

  get name() { return 'paystack'; }

  ensureConfigured() {
    if (!this.secretKey) throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Paystack is not configured for this environment');
  }

  async request(path, options = {}) {
    this.ensureConfigured();
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status) throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', payload.message || 'The payment provider could not complete the request');
    return payload.data;
  }

  async initializeTransaction(input) {
    return this.request('/transaction/initialize', { method: 'POST', body: JSON.stringify({ amount: input.amountMinor, email: input.email, currency: input.currency, reference: input.reference, callback_url: env.paymentCallbackUrl || undefined, metadata: input.metadata }) });
  }

  async verifyTransaction(reference) {
    return this.request(`/transaction/verify/${encodeURIComponent(reference)}`);
  }

  async listTransactions({ perPage = 100 } = {}) {
    return this.request(`/transaction?perPage=${Math.min(perPage, 100)}`);
  }

  verifyWebhookSignature(signature, rawBody) {
    this.ensureConfigured();
    if (!signature || !Buffer.isBuffer(rawBody)) return false;
    const expected = crypto.createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    const actualBuffer = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  }

  async refundTransaction(input) {
    const body = { transaction: input.providerReference };
    if (input.amountMinor !== undefined) body.amount = input.amountMinor;
    return this.request('/refund', { method: 'POST', body: JSON.stringify(body) });
  }
}

module.exports = { PaystackProvider };
