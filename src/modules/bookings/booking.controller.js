const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./booking.service');
const { env } = require('../../config/env');

const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { booking: (await service.createBooking(req.auth.userId, req.body)).toSafeJSON(), paymentAvailable: Boolean(env.paystackSecretKey), paymentMessage: env.paystackSecretKey ? 'Initialize payment using the payment endpoint.' : 'Payment provider configuration is required before a charge can be initialized.' } }));
const listMine = asyncHandler(async (req, res) => sendSuccess(res, await service.listCustomerBookings(req.auth.userId, req.query)));
const getMine = asyncHandler(async (req, res) => sendSuccess(res, { booking: (await service.getCustomerBooking(req.auth.userId, req.params.bookingId)).toSafeJSON() }));
const cancelMine = asyncHandler(async (req, res) => sendSuccess(res, { booking: (await service.cancelCustomerBooking(req.auth.userId, req.params.bookingId, req.body.reason)).toSafeJSON() }));
const rescheduleMine = asyncHandler(async (req, res) => { const booking = await service.getCustomerBooking(req.auth.userId, req.params.bookingId); return sendSuccess(res, { booking: (await service.rescheduleBooking({ booking, actorId: req.auth.userId, newStartAt: req.body.startAt, reason: req.body.reason })).toSafeJSON() }); });
const listBusiness = asyncHandler(async (req, res) => { const result = await service.listBusinessBookings(req.business._id, req.query, req.businessMembership); return sendSuccess(res, { ...result, bookings: result.bookings.map((booking) => ({ ...booking, customerId: booking.customerId?.toString() || null })) }); });
const transition = asyncHandler(async (req, res) => sendSuccess(res, { booking: (await service.transitionBusinessBooking(req.business._id, req.params.bookingId, req.auth.userId, req.body.action, req.body.reason, req.businessMembership)).toSafeJSON() }));
const rescheduleBusiness = asyncHandler(async (req, res) => { const booking = await service.getBusinessBooking(req.business._id, req.params.bookingId, req.businessMembership); return sendSuccess(res, { booking: (await service.rescheduleBooking({ booking, actorId: req.auth.userId, newStartAt: req.body.startAt, reason: req.body.reason })).toSafeJSON() }); });

module.exports = { create, listMine, getMine, cancelMine, rescheduleMine, listBusiness, transition, rescheduleBusiness };
