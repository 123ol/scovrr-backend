const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const controller = require('./product.controller');
const { createProductSchema, updateProductSchema, bulkUpdateProductSchema, bulkCreateProductSchema, bulkCsvProductSchema, productImportJobSchema, productImportJobIdSchema, productIdSchema, productListSchema, duplicateProductSchema, productExportSchema, inventoryAdjustmentSchema } = require('./product.validation');

const router = express.Router();

router.post('/:businessId/catalogue/products', requireAuth, requireBusinessPermission('products.create'), validate(createProductSchema), controller.create);
router.get('/:businessId/catalogue/products', requireAuth, requireBusinessPermission('products.read'), validate(productListSchema), controller.manageList);
router.get('/:businessId/catalogue/products/duplicates', requireAuth, requireBusinessPermission('products.read'), validate(duplicateProductSchema), controller.duplicates);
router.get('/:businessId/catalogue/products/export', requireAuth, requireBusinessPermission('products.read'), validate(productExportSchema), controller.exportProducts);
router.post('/:businessId/catalogue/products/bulk', requireAuth, requireBusinessPermission('products.create'), validate(bulkCreateProductSchema), controller.bulkCreate);
router.post('/:businessId/catalogue/products/bulk-csv', requireAuth, requireBusinessPermission('products.create'), validate(bulkCsvProductSchema), controller.bulkCreateCsv);
router.post('/:businessId/catalogue/products/import-jobs', requireAuth, requireBusinessPermission('products.create'), validate(productImportJobSchema), controller.requestCsvImport);
router.get('/:businessId/catalogue/products/import-jobs/:importJobId', requireAuth, requireBusinessPermission('products.read'), validate(productImportJobIdSchema), controller.getCsvImport);
router.patch('/:businessId/catalogue/products/bulk', requireAuth, requireBusinessPermission('products.update'), validate(bulkUpdateProductSchema), controller.bulkUpdate);
router.patch('/:businessId/catalogue/products/:productId', requireAuth, requireBusinessPermission('products.update'), validate(updateProductSchema), controller.update);
router.delete('/:businessId/catalogue/products/:productId', requireAuth, requireBusinessPermission('products.update'), validate(productIdSchema), controller.archive);
router.post('/:businessId/catalogue/products/:productId/submit', requireAuth, requireBusinessPermission('products.update'), validate(productIdSchema), controller.submit);
router.post('/:businessId/catalogue/products/:productId/inventory', requireAuth, requireBusinessPermission('inventory.adjust'), validate(inventoryAdjustmentSchema), controller.adjustInventory);

module.exports = router;
