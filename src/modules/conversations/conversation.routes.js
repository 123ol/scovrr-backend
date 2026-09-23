const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./conversation.controller');
const { startSchema, listSchema, messageListSchema, sendMessageSchema, conversationIdSchema } = require('./conversation.validation');

const router = express.Router();
router.use(requireAuth);
router.post('/', validate(startSchema), controller.start);
router.get('/', validate(listSchema), controller.list);
router.get('/:conversationId/messages', validate(messageListSchema), controller.messages);
router.post('/:conversationId/messages', validate(sendMessageSchema), controller.send);
router.post('/:conversationId/read', validate(conversationIdSchema), controller.read);

module.exports = router;
