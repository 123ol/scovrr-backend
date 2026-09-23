const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./cart.controller');
const { addItemSchema, updateItemSchema, removeItemSchema, couponSchema } = require('./cart.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.get);
router.post('/items', validate(addItemSchema), controller.add);
router.patch('/items', validate(updateItemSchema), controller.update);
router.delete('/items', validate(removeItemSchema), controller.remove);
router.post('/coupon', validate(couponSchema), controller.applyCoupon);
router.delete('/coupon', controller.removeCoupon);
router.delete('/', controller.clear);

module.exports = router;
