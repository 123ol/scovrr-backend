const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { PaystackPayoutProvider } = require('./paystack-payout.provider');

function getPayoutProvider(name = env.payoutProvider) {
  if (name === 'paystack') return new PaystackPayoutProvider();
  throw new AppError(503, 'PAYOUT_PROVIDER_UNAVAILABLE', `Payout provider ${name} is not available`);
}

module.exports = { getPayoutProvider };
