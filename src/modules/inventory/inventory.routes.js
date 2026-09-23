const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./inventory.controller');
const { listPositionsSchema, transferSchema } = require('./inventory.validation');

const router = express.Router();
router.get('/:businessId/inventory/positions', requireAuth, requireBusinessPermission('inventory.read'), validate(listPositionsSchema), controller.positions);
router.post('/:businessId/inventory/transfers', requireAuth, requireBusinessPermission('inventory.transfer'), validate(transferSchema), controller.transfer);

module.exports = router;
