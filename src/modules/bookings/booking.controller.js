const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./booking.service');
const { env } = require('../../config/env');
const waitlistService = require('./booking-waitlist.service');

const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { booking: (await service.createBooking(req.auth.userId, req.body)).toSafeJSON(), paymentAvailable: Boolean(env.paystackSecretKey), paymentMessage: env.paystackSecretKey ? 'Initialize payment using the payment endpoint.' : 'Payment provider configuration is required before a charge can be initialized.' } }));
const listMine = asyncHandler(async (req, res) => sendSuccess(res, await service.listCustomerBookings(req.auth.userId, req.query)));
const getMine = asyncHandler(async (req, res) => sendSuccess(res, { booking: (await service.getCustomerBooking(req.auth.userId, req.params.bookingId)).toSafeJSON() }));
const rebookMine = asyncHandler(async (req, res) => sendSuccess(res, await service.getRebookingOptions(req.auth.userId, req.params.bookingId)));
const recurringOptionsMine = asyncHandler(async (req, res) => sendSuccess(res, await service.getRecurringBookingOptions(req.auth.userId, req.params.bookingId)));
const cancelMine = asyncHandler(async (req, res) => sendSuccess(res, { booking: (await service.cancelCustomerBooking(req.auth.userId, req.params.bookingId, req.body.reason)).toSafeJSON() }));
const rescheduleMine = asyncHandler(async (req, res) => { const booking = await service.getCustomerBooking(req.auth.userId, req.params.bookingId); return sendSuccess(res, { booking: (await service.rescheduleBooking({ booking, actorId: req.auth.userId, newStartAt: req.body.startAt, reason: req.body.reason })).toSafeJSON() }); });
const listBusiness = asyncHandler(async (req, res) => { const result = await service.listBusinessBookings(req.business._id, req.query, req.businessMembership); return sendSuccess(res, { ...result, bookings: result.bookings.map((booking) => ({ ...booking, customerId: booking.customerId?.toString() || null })) }); });
const transition = asyncHandler(async (req, res) => sendSuccess(res, { booking: (await service.transitionBusinessBooking(req.business._id, req.params.bookingId, req.auth.userId, req.body.action, req.body.reason, req.businessMembership)).toSafeJSON() }));
const rescheduleBusiness = asyncHandler(async (req, res) => { const booking = await service.getBusinessBooking(req.business._id, req.params.bookingId, req.businessMembership); return sendSuccess(res, { booking: (await service.rescheduleBooking({ booking, actorId: req.auth.userId, newStartAt: req.body.startAt, reason: req.body.reason })).toSafeJSON() }); });
const joinWaitlist = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { waitlist: (await waitlistService.joinWaitlist(req.auth.userId, req.body)).toSafeJSON() } }));
const listWaitlist = asyncHandler(async (req, res) => sendSuccess(res, { waitlist: await waitlistService.listWaitlist(req.auth.userId) }));
const leaveWaitlist = asyncHandler(async (req, res) => sendSuccess(res, { waitlist: (await waitlistService.leaveWaitlist(req.auth.userId, req.params.waitlistId)).toSafeJSON() }));
const acceptWaitlistOffer = asyncHandler(async (req, res) => { const result = await waitlistService.acceptWaitlistOffer(req.auth.userId, req.params.waitlistId); return sendSuccess(res, { waitlist: result.waitlist.toSafeJSON(), booking: result.booking.toSafeJSON(), paymentAvailable: Boolean(env.paystackSecretKey), paymentMessage: env.paystackSecretKey ? 'Initialize payment using the payment endpoint.' : 'Payment provider configuration is required before a charge can be initialized.' }); });

module.exports = { create, listMine, getMine, rebookMine, recurringOptionsMine, cancelMine, rescheduleMine, listBusiness, transition, rescheduleBusiness, joinWaitlist, listWaitlist, leaveWaitlist, acceptWaitlistOffer };
