const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./recently-viewed.controller');
const { viewSchema, listSchema } = require('./recently-viewed.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listSchema), controller.list);
router.post('/', validate(viewSchema), controller.record);

module.exports = router;
