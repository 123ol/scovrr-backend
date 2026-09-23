const express = require('express');
const { validate } = require('../../common/validation/validate');
const controller = require('./recommendation.controller');
const { discoverSchema } = require('../discovery/discovery.validation');

const router = express.Router();
router.get('/home', validate(discoverSchema), controller.home);

module.exports = router;
