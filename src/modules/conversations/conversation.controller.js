const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./conversation.service');

const start = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { conversation: (await service.createConversation(req.auth.userId, req.body)).toSafeJSON(req.auth.userId) } }));
const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listConversations(req.auth.userId, req.query)));
const messages = asyncHandler(async (req, res) => sendSuccess(res, await service.listMessages(req.auth.userId, req.params.conversationId, req.query)));
const send = asyncHandler(async (req, res) => { const result = await service.sendMessage(req.auth.userId, req.params.conversationId, req.body); return res.status(201).json({ success: true, data: { message: result.message.toSafeJSON(), conversation: result.conversation.toSafeJSON(req.auth.userId) } }); });
const read = asyncHandler(async (req, res) => sendSuccess(res, { conversation: (await service.markRead(req.auth.userId, req.params.conversationId)).toSafeJSON(req.auth.userId) }));

module.exports = { start, list, messages, send, read };
