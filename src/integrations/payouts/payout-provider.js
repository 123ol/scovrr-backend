class PayoutProvider {
  get name() { throw new Error('Payout provider name is not implemented'); }

  async initiateTransfer() { throw new Error('Payout initiation is not implemented'); }

  async verifyTransfer() { throw new Error('Payout verification is not implemented'); }
}

module.exports = { PayoutProvider };
