const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./review.controller');
const { businessListReviewSchema, responseSchema } = require('./review.validation');

const router = express.Router();
router.get('/:businessId/reviews', validate(businessListReviewSchema), controller.listBusiness);
router.post('/:businessId/reviews/:reviewId/respond', requireAuth, requireBusinessPermission('customers.manage'), validate(responseSchema), controller.respond);

module.exports = router;
