const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./follow.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listFollows(req.auth.userId, req.query)));
const add = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { follow: await service.addFollow(req.auth.userId, req.params.businessId) } }));
const remove = asyncHandler(async (req, res) => { await service.removeFollow(req.auth.userId, req.params.businessId); return res.status(204).send(); });
const listUsers = asyncHandler(async (req, res) => sendSuccess(res, await service.listUserFollows(req.auth.userId, req.query)));
const addUser = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { follow: await service.addUserFollow(req.auth.userId, req.params.userId) } }));
const removeUser = asyncHandler(async (req, res) => { await service.removeUserFollow(req.auth.userId, req.params.userId); return res.status(204).send(); });

module.exports = { list, add, remove, listUsers, addUser, removeUser };
