const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./order.controller');
const { checkoutSchema, orderIdSchema } = require('./order.validation');

const router = express.Router();
router.use(requireAuth);
router.post('/checkout/preview', validate(checkoutSchema), controller.preview);
router.post('/checkout/orders', validate(checkoutSchema), controller.create);
router.get('/', controller.list);
router.post('/:orderId/reorder', validate(orderIdSchema), controller.reorder);
router.get('/:orderId', validate(orderIdSchema), controller.get);
router.post('/:orderId/cancel', validate(orderIdSchema), controller.cancel);

module.exports = router;
