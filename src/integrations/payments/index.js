const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { PaystackProvider } = require('./paystack.provider');

function getPaymentProvider(name = 'paystack') {
  if (name === 'paystack') {
    if (!env.paystackSecretKey) throw new AppError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Paystack is not configured for this environment');
    return new PaystackProvider();
  }
  throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', `Payment provider ${name} is not available`);
}

module.exports = { getPaymentProvider };
