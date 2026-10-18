const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./delivery.controller');
const { customerDeliverySchema, businessDeliverySchema, businessDeliveryGetSchema } = require('./delivery.validation');

const router = express.Router();
router.get('/orders/:orderId/delivery', requireAuth, validate(customerDeliverySchema), controller.customer);
router.get('/businesses/:businessId/deliveries/:deliveryId', requireAuth, requireBusinessPermission('orders.read'), validate(businessDeliveryGetSchema), controller.businessGet);
router.post('/businesses/:businessId/deliveries/:deliveryId/transition', requireAuth, requireBusinessPermission(['orders.fulfill', 'orders.manage'], { allowSuspended: true }), validate(businessDeliverySchema), controller.business);

module.exports = router;
