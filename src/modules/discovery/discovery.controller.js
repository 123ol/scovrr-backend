const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./discovery.service');

const discover = asyncHandler(async (req, res) => sendSuccess(res, await service.discover(req.query, req.auth?.userId)));
const nearby = asyncHandler(async (req, res) => sendSuccess(res, await service.listNearbyBusinesses(req.query)));
const suggestions = asyncHandler(async (req, res) => sendSuccess(res, await service.searchSuggestions(req.query.q, req.auth?.userId)));
const history = asyncHandler(async (req, res) => sendSuccess(res, { history: await service.listSearchHistory(req.auth.userId, req.query.limit) }));
const recordHistory = asyncHandler(async (req, res) => sendSuccess(res, { history: (await service.recordSearch(req.auth.userId, req.body.query)).toSafeJSON() }));
const removeHistory = asyncHandler(async (req, res) => { await service.removeSearchHistory(req.auth.userId, req.params.historyId); return res.status(204).send(); });

module.exports = { discover, nearby, suggestions, history, recordHistory, removeHistory };
