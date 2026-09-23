const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./booking.controller');
const bookingService = require('./booking.service');
const { businessBookingListSchema, businessBookingIdSchema, transitionSchema, rescheduleSchema } = require('./booking.validation');

const router = express.Router();
router.get('/:businessId/bookings', requireAuth, requireBusinessPermission('bookings.read'), validate(businessBookingListSchema), controller.listBusiness);
router.post('/:businessId/bookings/:bookingId/transition', requireAuth, requireBusinessPermission('bookings.manage', { allowSuspended: true }), validate(transitionSchema), controller.transition);
router.post('/:businessId/bookings/:bookingId/reschedule', requireAuth, requireBusinessPermission('bookings.manage', { allowSuspended: true }), validate(rescheduleSchema), controller.rescheduleBusiness);
router.get('/:businessId/bookings/:bookingId', requireAuth, requireBusinessPermission('bookings.read'), validate(businessBookingIdSchema), async (req, res, next) => { try { const booking = await bookingService.getBusinessBooking(req.business._id, req.params.bookingId, req.businessMembership); return res.json({ success: true, data: { booking: { ...booking.toSafeJSON(), customerId: booking.customerId.toString() } } }); } catch (error) { return next(error); } });

module.exports = router;
