const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const controller = require('./business.controller');
const { createBusinessSchema, capabilitiesSchema, createLocationSchema, updateLocationSchema, businessIdSchema, attachVerificationEvidenceSchema, storefrontUpdateSchema, messagingUpdateSchema } = require('./business.validation');

const router = express.Router();

router.post('/', requireAuth, validate(createBusinessSchema), controller.create);
router.get('/mine', requireAuth, controller.mine);
router.get('/:slug', controller.publicBySlug);

router.patch('/:businessId/storefront', requireAuth, requireBusinessPermission('business.manage'), validate(storefrontUpdateSchema), controller.updateStorefront);
router.patch('/:businessId/messaging', requireAuth, requireBusinessPermission('business.manage'), validate(messagingUpdateSchema), controller.updateMessaging);
router.patch('/:businessId/capabilities', requireAuth, requireBusinessPermission('business.capabilities.manage'), validate(capabilitiesSchema), controller.updateCapabilities);
router.post('/:businessId/locations', requireAuth, requireBusinessPermission('locations.create'), validate(createLocationSchema), controller.addLocation);
router.get('/:businessId/locations', validate(businessIdSchema), controller.listLocations);
router.get('/:businessId/locations/manage', requireAuth, requireBusinessPermission('locations.read'), validate(businessIdSchema), controller.listPrivateLocations);
router.patch('/:businessId/locations/:locationId', requireAuth, requireBusinessPermission('locations.update'), validate(updateLocationSchema), controller.updateLocation);
router.post('/:businessId/submit', requireAuth, requireBusinessPermission('business.manage'), validate(businessIdSchema), controller.submit);
router.post('/:businessId/verification/evidence', requireAuth, requireBusinessPermission('business.manage'), validate(attachVerificationEvidenceSchema), controller.attachVerificationEvidence);

module.exports = router;
