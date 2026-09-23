const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./booking.controller');
const { createBookingSchema, bookingIdSchema, bookingListSchema, actionSchema, rescheduleSchema } = require('./booking.validation');

const router = express.Router();
router.use(requireAuth);
router.post('/', validate(createBookingSchema), controller.create);
router.get('/', validate(bookingListSchema), controller.listMine);
router.get('/:bookingId', validate(bookingIdSchema), controller.getMine);
router.post('/:bookingId/cancel', validate(actionSchema), controller.cancelMine);
router.post('/:bookingId/reschedule', validate(rescheduleSchema), controller.rescheduleMine);

module.exports = router;
