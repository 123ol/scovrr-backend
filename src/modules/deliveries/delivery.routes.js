const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./delivery.controller');
const { customerDeliverySchema, businessDeliverySchema } = require('./delivery.validation');

const router = express.Router();
router.get('/orders/:orderId/delivery', requireAuth, validate(customerDeliverySchema), controller.customer);
router.post('/businesses/:businessId/deliveries/:deliveryId/transition', requireAuth, requireBusinessPermission(['orders.fulfill', 'orders.manage'], { allowSuspended: true }), validate(businessDeliverySchema), controller.business);

module.exports = router;
