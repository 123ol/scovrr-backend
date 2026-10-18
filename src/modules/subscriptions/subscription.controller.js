const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./subscription.service');
const paymentService = require('../payments/payment.service');

const plans = asyncHandler(async (_req, res) => sendSuccess(res, { plans: await service.listPlans() }));
const get = asyncHandler(async (req, res) => sendSuccess(res, await service.getBusinessOverview(req.business._id)));
const invoices = asyncHandler(async (req, res) => sendSuccess(res, await service.listInvoices(req.business._id, req.query)));
const cancel = asyncHandler(async (req, res) => sendSuccess(res, { subscription: (await service.cancelAtPeriodEnd(req.business._id, req.body.reason)).toSafeJSON() }));
const resume = asyncHandler(async (req, res) => { const subscription = await service.resumeAtPeriodEnd(req.business._id); return sendSuccess(res, { subscription: subscription.toSafeJSON(), renewal: service.renewalState(subscription) }); });
const scheduleChange = asyncHandler(async (req, res) => sendSuccess(res, { subscription: (await service.scheduleDowngrade(req.business._id, req.body)).toSafeJSON() }));
const checkout = asyncHandler(async (req, res) => {
  const payment = await paymentService.initializeSubscriptionPayment(req.auth.userId, req.business._id, req.body);
  return res.status(201).json({ success: true, data: { payment: payment.toSafeJSON() } });
});
const recovery = asyncHandler(async (req, res) => {
  const payment = await paymentService.initializeSubscriptionRecoveryPayment(req.auth.userId, req.business._id, req.body);
  return res.status(201).json({ success: true, data: { payment: payment.toSafeJSON(), recovery: true } });
});

module.exports = { plans, get, invoices, cancel, resume, scheduleChange, checkout, recovery };
