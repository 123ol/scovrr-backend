const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { PayoutProvider } = require('./payout-provider');

const API_URL = 'https://api.paystack.co';

class PaystackPayoutProvider extends PayoutProvider {
  constructor(secretKey = env.paystackSecretKey) {
    super();
    this.secretKey = secretKey;
  }

  get name() { return 'paystack'; }

  ensureConfigured() {
    if (!this.secretKey) throw new AppError(503, 'PAYOUT_PROVIDER_NOT_CONFIGURED', 'Paystack transfers are not configured for this environment');
  }

  async request(path, options = {}) {
    this.ensureConfigured();
    const response = await fetch(`${API_URL}${path}`, { ...options, headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status) throw new AppError(502, 'PAYOUT_PROVIDER_ERROR', payload.message || 'The payout provider could not complete the request');
    return payload.data;
  }

  async initiateTransfer(input) {
    return this.request('/transfer', { method: 'POST', body: JSON.stringify({ source: 'balance', amount: input.amountMinor, recipient: input.recipientCode, reference: input.reference, reason: input.reason, currency: input.currency }) });
  }

  async verifyTransfer(reference) {
    return this.request(`/transfer/verify/${encodeURIComponent(reference)}`);
  }
}

module.exports = { PaystackPayoutProvider };
