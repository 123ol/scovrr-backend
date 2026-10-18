const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./dispute.controller');
const { createDisputeSchema, disputeIdSchema, disputeListSchema, attachEvidenceSchema, policySchema } = require('./dispute.validation');

const router = express.Router();
router.use(requireAuth);
router.post('/', validate(createDisputeSchema), controller.create);
router.get('/policy', validate(policySchema), controller.policy);
router.post('/:disputeId/evidence', validate(attachEvidenceSchema), controller.addEvidence);
router.get('/', validate(disputeListSchema), controller.mine);
router.get('/:disputeId', validate(disputeIdSchema), controller.getMine);

module.exports = router;
