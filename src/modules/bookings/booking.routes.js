const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./booking.controller');
const { createBookingSchema, bookingIdSchema, bookingListSchema, actionSchema, rescheduleSchema, waitlistCreateSchema, waitlistListSchema, waitlistIdSchema } = require('./booking.validation');

const router = express.Router();
router.use(requireAuth);
router.post('/', validate(createBookingSchema), controller.create);
router.get('/', validate(bookingListSchema), controller.listMine);
router.post('/waitlist', validate(waitlistCreateSchema), controller.joinWaitlist);
router.get('/waitlist', validate(waitlistListSchema), controller.listWaitlist);
router.post('/waitlist/:waitlistId/accept', validate(waitlistIdSchema), controller.acceptWaitlistOffer);
router.post('/waitlist/:waitlistId/leave', validate(waitlistIdSchema), controller.leaveWaitlist);
router.get('/:bookingId/rebook', validate(bookingIdSchema), controller.rebookMine);
router.get('/:bookingId/recurring-options', validate(bookingIdSchema), controller.recurringOptionsMine);
router.get('/:bookingId', validate(bookingIdSchema), controller.getMine);
router.post('/:bookingId/cancel', validate(actionSchema), controller.cancelMine);
router.post('/:bookingId/reschedule', validate(rescheduleSchema), controller.rescheduleMine);

module.exports = router;
