const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const controller = require('./business.controller');
const { createBusinessSchema, capabilitiesSchema, createLocationSchema, updateLocationSchema, businessIdSchema } = require('./business.validation');

const router = express.Router();

router.post('/', requireAuth, validate(createBusinessSchema), controller.create);
router.get('/mine', requireAuth, controller.mine);
router.get('/:slug', controller.publicBySlug);

router.patch('/:businessId/capabilities', requireAuth, requireBusinessPermission('business.capabilities.manage'), validate(capabilitiesSchema), controller.updateCapabilities);
router.post('/:businessId/locations', requireAuth, requireBusinessPermission('locations.create'), validate(createLocationSchema), controller.addLocation);
router.get('/:businessId/locations', validate(businessIdSchema), controller.listLocations);
router.get('/:businessId/locations/manage', requireAuth, requireBusinessPermission('locations.read'), validate(businessIdSchema), controller.listPrivateLocations);
router.patch('/:businessId/locations/:locationId', requireAuth, requireBusinessPermission('locations.update'), validate(updateLocationSchema), controller.updateLocation);
router.post('/:businessId/submit', requireAuth, requireBusinessPermission('business.manage'), validate(businessIdSchema), controller.submit);

module.exports = router;
