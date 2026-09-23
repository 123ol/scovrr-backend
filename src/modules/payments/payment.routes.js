const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./payment.controller');
const { initializeSchema, initializeBookingSchema, paymentIdSchema } = require('./payment.validation');

const router = express.Router();
router.post('/webhooks/paystack', controller.webhook);
router.use(requireAuth);
router.post('/orders/:orderId/initialize', validate(initializeSchema), controller.initializeOrder);
router.post('/bookings/:bookingId/initialize', validate(initializeBookingSchema), controller.initializeBooking);
router.get('/:paymentId', validate(paymentIdSchema), controller.get);
router.post('/:paymentId/verify', validate(paymentIdSchema), controller.verify);

module.exports = router;
