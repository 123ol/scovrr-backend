const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./moderation-appeal.controller');
const validation = require('./moderation-appeal.validation');

const router = express.Router();
const appealPermission = 'business.manage';

router.get('/:businessId/moderation-appeals/eligible', requireAuth, requireBusinessPermission(appealPermission), validate(validation.businessIdSchema), controller.businessEligible);
router.get('/:businessId/moderation-appeals', requireAuth, requireBusinessPermission(appealPermission), validate(validation.businessListSchema), controller.businessList);
router.post('/:businessId/moderation-appeals', requireAuth, requireBusinessPermission(appealPermission), validate(validation.createSchema), controller.businessCreate);
router.get('/:businessId/moderation-appeals/:appealId', requireAuth, requireBusinessPermission(appealPermission), validate(validation.appealIdSchema), controller.businessGet);

module.exports = router;
