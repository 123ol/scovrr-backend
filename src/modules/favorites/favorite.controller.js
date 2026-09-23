const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./favorite.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, { favorites: await service.listFavorites(req.auth.userId) }));
const add = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { favorite: await service.addFavorite(req.auth.userId, req.body) } }));
const remove = asyncHandler(async (req, res) => { await service.removeFavorite(req.auth.userId, req.params.targetType, req.params.targetId); return res.status(204).send(); });

module.exports = { list, add, remove };
