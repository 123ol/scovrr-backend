const express = require('express');
const { validate } = require('../../common/validation/validate');
const controller = require('./availability.controller');
const { availabilityQuerySchema } = require('./availability.validation');

const router = express.Router();
router.get('/', validate(availabilityQuerySchema), controller.publicSlots);

module.exports = router;
