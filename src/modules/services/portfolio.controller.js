const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./portfolio.service');

const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { item: (await service.createPortfolioItem(req.business._id, req.body)).toJSONSafe() } }));
const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listPortfolioItems(req.business._id, req.query)));
const update = asyncHandler(async (req, res) => sendSuccess(res, { item: (await service.updatePortfolioItem(req.business._id, req.params.portfolioId, req.body)).toJSONSafe() }));
const publicList = asyncHandler(async (req, res) => sendSuccess(res, { items: await service.listPublicPortfolio(req.business._id) }));

module.exports = { create, list, update, publicList };
