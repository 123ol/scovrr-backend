const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./promotion.controller');
const { createPromotionSchema, updatePromotionSchema, listPromotionSchema, disableCouponSchema } = require('./promotion.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/:businessId/promotions', requireBusinessPermission('discounts.read'), validate(listPromotionSchema), controller.list);
router.post('/:businessId/promotions', requireBusinessPermission('discounts.manage'), validate(createPromotionSchema), controller.create);
router.patch('/:businessId/promotions/:promotionId', requireBusinessPermission('discounts.manage'), validate(updatePromotionSchema), controller.update);
router.post('/:businessId/promotions/:promotionId/coupons/disable', requireBusinessPermission('discounts.manage'), validate(disableCouponSchema), controller.disableCoupon);

// /discounts is the production vocabulary; /promotions remains a backwards-compatible alias.
router.get('/:businessId/discounts', requireBusinessPermission('discounts.read'), validate(listPromotionSchema), controller.list);
router.post('/:businessId/discounts', requireBusinessPermission('discounts.manage'), validate(createPromotionSchema), controller.create);
router.patch('/:businessId/discounts/:promotionId', requireBusinessPermission('discounts.manage'), validate(updatePromotionSchema), controller.update);
router.post('/:businessId/discounts/:promotionId/coupons/disable', requireBusinessPermission('discounts.manage'), validate(disableCouponSchema), controller.disableCoupon);

module.exports = router;
