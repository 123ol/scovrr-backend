const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./order.service');
const { env } = require('../../config/env');

const preview = asyncHandler(async (req, res) => sendSuccess(res, { checkout: await service.previewCheckout(req.auth.userId, req.body) }));
const create = asyncHandler(async (req, res) => {
  const order = await service.createPendingOrder(req.auth.userId, req.body);
  return res.status(201).json({ success: true, data: { order: order.toSafeJSON(), delivery: order.deliverySnapshot, pickupCode: order._pickupCode || null, payment: { available: Boolean(env.paystackSecretKey), status: order.paymentStatus, message: env.paystackSecretKey ? 'Initialize payment using the payment endpoint.' : 'Payment provider configuration is required before a charge can be initialized.' } } });
});
const list = asyncHandler(async (req, res) => sendSuccess(res, { orders: await service.listOrders(req.auth.userId) }));
const get = asyncHandler(async (req, res) => sendSuccess(res, { order: (await service.getOrder(req.auth.userId, req.params.orderId)).toSafeJSON() }));
const cancel = asyncHandler(async (req, res) => sendSuccess(res, { order: (await service.cancelPendingOrder(req.auth.userId, req.params.orderId)).toSafeJSON() }));

module.exports = { preview, create, list, get, cancel };
