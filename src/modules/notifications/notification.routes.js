const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./notification.controller');
const { listSchema, notificationIdSchema, deviceSchema, deviceDeleteSchema } = require('./notification.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', validate(listSchema), controller.list);
router.post('/devices', validate(deviceSchema), controller.registerDevice);
router.delete('/devices/:token', validate(deviceDeleteSchema), controller.removeDevice);
router.post('/:notificationId/read', validate(notificationIdSchema), controller.read);

module.exports = router;
