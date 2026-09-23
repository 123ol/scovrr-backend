const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./notification.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listNotifications(req.auth.userId, req.query)));
const read = asyncHandler(async (req, res) => sendSuccess(res, { notification: (await service.markRead(req.auth.userId, req.params.notificationId)).toSafeJSON() }));
const registerDevice = asyncHandler(async (req, res) => sendSuccess(res, { device: await service.registerDevice(req.auth.userId, req.body) }));
const removeDevice = asyncHandler(async (req, res) => { await service.removeDevice(req.auth.userId, req.params.token); return res.status(204).send(); });

module.exports = { list, read, registerDevice, removeDevice };
