const express = require('express');
const controller = require('./email.controller');

const router = express.Router();
router.post('/', controller.webhook);

module.exports = router;
