const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./favorite.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, { favorites: await service.listFavorites(req.auth.userId) }));
const add = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { favorite: await service.addFavorite(req.auth.userId, req.body) } }));
const remove = asyncHandler(async (req, res) => { await service.removeFavorite(req.auth.userId, req.params.targetType, req.params.targetId); return res.status(204).send(); });
const collections = asyncHandler(async (req, res) => sendSuccess(res, { collections: await service.listCollections(req.auth.userId) }));
const createCollection = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { collection: (await service.createCollection(req.auth.userId, req.body)).toSafeJSON() } }));
const updateCollection = asyncHandler(async (req, res) => sendSuccess(res, { collection: (await service.updateCollection(req.auth.userId, req.params.collectionId, req.body)).toSafeJSON() }));
const assignCollection = asyncHandler(async (req, res) => sendSuccess(res, { favorite: await service.assignFavoriteToCollection(req.auth.userId, req.params.targetType, req.params.targetId, req.body.collectionId) }));

module.exports = { list, add, remove, collections, createCollection, updateCollection, assignCollection };
