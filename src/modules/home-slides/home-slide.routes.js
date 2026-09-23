const express = require('express');
const { validate } = require('../../common/validation/validate');
const controller = require('./home-slide.controller');
const { publicHomeSlideSchema } = require('./home-slide.validation');

const router = express.Router();
router.get('/', validate(publicHomeSlideSchema), controller.publicList);

module.exports = router;
