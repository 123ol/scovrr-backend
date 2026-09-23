const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./service.controller');
const { createServiceSchema, updateServiceSchema, serviceIdSchema, serviceListSchema } = require('./service.validation');

const router = express.Router();
router.post('/:businessId/catalogue/services', requireAuth, requireBusinessPermission('services.create'), validate(createServiceSchema), controller.create);
router.get('/:businessId/catalogue/services', requireAuth, requireBusinessPermission('services.read'), validate(serviceListSchema), controller.manageList);
router.patch('/:businessId/catalogue/services/:serviceId', requireAuth, requireBusinessPermission('services.update'), validate(updateServiceSchema), controller.update);
router.post('/:businessId/catalogue/services/:serviceId/submit', requireAuth, requireBusinessPermission('services.update'), validate(serviceIdSchema), controller.submit);

module.exports = router;
