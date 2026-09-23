const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./review.controller');
const { createReviewSchema, listReviewSchema } = require('./review.validation');

const router = express.Router();
router.get('/products/:targetId/reviews', validate(listReviewSchema), controller.listProduct);
router.get('/services/:targetId/reviews', validate(listReviewSchema), controller.listService);
router.use(requireAuth);
router.post('/', validate(createReviewSchema), controller.create);

module.exports = router;
