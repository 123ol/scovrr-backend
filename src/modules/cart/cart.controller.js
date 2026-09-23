const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./cart.service');

const get = asyncHandler(async (req, res) => sendSuccess(res, { cart: await service.getCartView(req.auth.userId) }));
const add = asyncHandler(async (req, res) => sendSuccess(res, { cart: await service.addItem(req.auth.userId, req.body) }));
const update = asyncHandler(async (req, res) => sendSuccess(res, { cart: await service.updateItem(req.auth.userId, req.body) }));
const remove = asyncHandler(async (req, res) => sendSuccess(res, { cart: await service.removeItem(req.auth.userId, req.body) }));
const clear = asyncHandler(async (req, res) => { await service.clearCart(req.auth.userId); return res.status(204).send(); });
const applyCoupon = asyncHandler(async (req, res) => sendSuccess(res, { cart: await service.applyCoupon(req.auth.userId, req.body.code) }));
const removeCoupon = asyncHandler(async (req, res) => sendSuccess(res, { cart: await service.removeCoupon(req.auth.userId) }));

module.exports = { get, add, update, remove, clear, applyCoupon, removeCoupon };
