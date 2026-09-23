const express = require('express');
const { validate } = require('../../common/validation/validate');
const controller = require('./discovery.controller');
const { discoverSchema } = require('./discovery.validation');

const router = express.Router();

router.get('/', validate(discoverSchema), controller.discover);

module.exports = router;
