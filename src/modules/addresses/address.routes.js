const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./address.controller');
const { createAddressSchema, updateAddressSchema, addressIdSchema } = require('./address.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.list);
router.post('/', validate(createAddressSchema), controller.create);
router.patch('/:addressId', validate(updateAddressSchema), controller.update);
router.delete('/:addressId', validate(addressIdSchema), controller.remove);

module.exports = router;
