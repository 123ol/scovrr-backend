const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./follow.controller');
const { businessIdSchema, listSchema, userIdSchema } = require('./follow.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listSchema), controller.list);
router.get('/users', validate(listSchema), controller.listUsers);
router.post('/businesses/:businessId', validate(businessIdSchema), controller.add);
router.delete('/businesses/:businessId', validate(businessIdSchema), controller.remove);
router.post('/users/:userId', validate(userIdSchema), controller.addUser);
router.delete('/users/:userId', validate(userIdSchema), controller.removeUser);

module.exports = router;
