class PaymentProvider {
  get name() { throw new Error('Payment provider name is not implemented'); }

  async initializeTransaction() { throw new Error('Payment initialization is not implemented'); }

  async verifyTransaction() { throw new Error('Payment verification is not implemented'); }

  async listTransactions() { throw new Error('Payment transaction listing is not implemented'); }

  verifyWebhookSignature() { throw new Error('Webhook signature verification is not implemented'); }

  async refundTransaction() { throw new Error('Refunds are not implemented'); }
}

module.exports = { PaymentProvider };
