const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const controller = require('./product.controller');
const { createProductSchema, updateProductSchema, productIdSchema, productListSchema, inventoryAdjustmentSchema } = require('./product.validation');

const router = express.Router();

router.post('/:businessId/catalogue/products', requireAuth, requireBusinessPermission('products.create'), validate(createProductSchema), controller.create);
router.get('/:businessId/catalogue/products', requireAuth, requireBusinessPermission('products.read'), validate(productListSchema), controller.manageList);
router.patch('/:businessId/catalogue/products/:productId', requireAuth, requireBusinessPermission('products.update'), validate(updateProductSchema), controller.update);
router.post('/:businessId/catalogue/products/:productId/submit', requireAuth, requireBusinessPermission('products.update'), validate(productIdSchema), controller.submit);
router.post('/:businessId/catalogue/products/:productId/inventory', requireAuth, requireBusinessPermission('inventory.adjust'), validate(inventoryAdjustmentSchema), controller.adjustInventory);

module.exports = router;
