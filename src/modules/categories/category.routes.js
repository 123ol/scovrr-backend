const express = require('express');
const { validate } = require('../../common/validation/validate');
const controller = require('./category.controller');
const { listCategorySchema } = require('./category.validation');

const router = express.Router();
router.get('/', validate(listCategorySchema), controller.list);

module.exports = router;
