const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./availability.controller');
const { upsertAvailabilitySchema, createBlockSchema, blockIdSchema } = require('./availability.validation');

const router = express.Router();
router.get('/:businessId/availability', requireAuth, requireBusinessPermission('availability.read'), controller.getRule);
router.put('/:businessId/availability', requireAuth, requireBusinessPermission('availability.manage'), validate(upsertAvailabilitySchema), controller.saveRule);
router.get('/:businessId/availability/blocks', requireAuth, requireBusinessPermission('availability.read'), controller.listBlocks);
router.post('/:businessId/availability/blocks', requireAuth, requireBusinessPermission('availability.manage'), validate(createBlockSchema), controller.createBlock);
router.delete('/:businessId/availability/blocks/:blockId', requireAuth, requireBusinessPermission('availability.manage'), validate(blockIdSchema), controller.deleteBlock);

module.exports = router;
