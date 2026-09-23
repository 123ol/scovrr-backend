const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const service = require('./order.service');
const { businessOrderListSchema, businessOrderActionSchema } = require('./order.validation');

const router = express.Router();
router.get('/:businessId/orders', requireAuth, requireBusinessPermission('orders.read'), validate(businessOrderListSchema), async (req, res, next) => { try { return res.json({ success: true, data: await service.listBusinessOrders(req.business._id, req.query, req.businessMembership) }); } catch (error) { return next(error); } });
router.post('/:businessId/orders/:orderId/transition', requireAuth, requireBusinessPermission(['orders.accept', 'orders.fulfill', 'orders.cancel'], { allowSuspended: true }), validate(businessOrderActionSchema), async (req, res, next) => { try { const order = await service.transitionBusinessOrder({ businessId: req.business._id, orderId: req.params.orderId, actorId: req.auth.userId, action: req.body.action, membership: req.businessMembership, reason: req.body.reason }); return res.json({ success: true, data: { order: order.toSafeJSON() } }); } catch (error) { return next(error); } });

module.exports = router;
