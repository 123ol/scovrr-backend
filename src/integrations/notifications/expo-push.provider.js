const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');

const PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

class ExpoPushProvider {
  constructor(accessToken = env.expoAccessToken) {
    this.accessToken = accessToken;
  }

  ensureConfigured() {
    if (!this.accessToken) throw new AppError(503, 'PUSH_PROVIDER_NOT_CONFIGURED', 'Expo push delivery is not configured for this environment');
  }

  async request(url, body) {
    this.ensureConfigured();
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.errors?.length) throw new AppError(502, 'PUSH_PROVIDER_ERROR', payload.errors?.[0]?.message || 'Expo push service could not complete the request');
    return payload;
  }

  async sendMessages(messages) {
    const tickets = [];
    for (let index = 0; index < messages.length; index += 100) {
      const payload = await this.request(PUSH_URL, messages.slice(index, index + 100));
      tickets.push(...(payload.data || []));
    }
    return tickets;
  }

  async getReceipts(ticketIds) {
    const receipts = {};
    for (let index = 0; index < ticketIds.length; index += 100) {
      const payload = await this.request(RECEIPTS_URL, { ids: ticketIds.slice(index, index + 100) });
      Object.assign(receipts, payload.data || {});
    }
    return receipts;
  }
}

module.exports = { ExpoPushProvider };
