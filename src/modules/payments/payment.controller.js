const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./payment.service');
const { recordAudit } = require('../audit/audit.service');

const initializeOrder = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { payment: (await service.initializePayment(req.auth.userId, 'order', req.params.orderId, req.body)).toSafeJSON() } }));
const initializeBooking = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { payment: (await service.initializePayment(req.auth.userId, 'booking', req.params.bookingId, req.body)).toSafeJSON() } }));
const retryOrder = asyncHandler(async (req, res) => sendSuccess(res, { payment: (await service.retryPayment(req.auth.userId, 'order', req.params.orderId, req.body)).toSafeJSON() }));
const retryBooking = asyncHandler(async (req, res) => sendSuccess(res, { payment: (await service.retryPayment(req.auth.userId, 'booking', req.params.bookingId, req.body)).toSafeJSON() }));
const verify = asyncHandler(async (req, res) => sendSuccess(res, { payment: (await service.verifyPayment(req.auth.userId, req.params.paymentId)).toSafeJSON() }));
const get = asyncHandler(async (req, res) => sendSuccess(res, { payment: (await service.getPayment(req.auth.userId, req.params.paymentId)).toSafeJSON() }));
const webhook = asyncHandler(async (req, res) => { await service.processPaystackWebhook(req.body, req.get('x-paystack-signature')); return res.status(200).json({ success: true, data: { received: true } }); });
const refund = asyncHandler(async (req, res) => { const item = await service.requestRefund(req.auth.userId, req.params.paymentId, req.body); await recordAudit({ actorId: req.auth.userId, action: 'REFUND_EXECUTED', targetType: 'refund', targetId: item._id, reason: req.body.reason, after: item.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { refund: item.toSafeJSON() }); });
const adminList = asyncHandler(async (req, res) => sendSuccess(res, await service.listAdminPayments(req.query)));
const adminRiskList = asyncHandler(async (req, res) => sendSuccess(res, await service.listPaymentRiskAssessments(req.query)));

module.exports = { initializeOrder, initializeBooking, retryOrder, retryBooking, verify, get, webhook, refund, adminList, adminRiskList };
