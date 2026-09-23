const express = require('express');
const { optionalAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./analytics.controller');
const { createEventSchema, batchEventSchema } = require('./analytics.validation');

const router = express.Router();
router.post('/', optionalAuth, validate(createEventSchema), controller.create);
router.post('/batch', optionalAuth, validate(batchEventSchema), controller.batch);

module.exports = router;
