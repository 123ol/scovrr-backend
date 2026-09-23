const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./address.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, { addresses: await service.listAddresses(req.auth.userId) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { address: (await service.createAddress(req.auth.userId, req.body)).toSafeJSON() } }));
const update = asyncHandler(async (req, res) => sendSuccess(res, { address: (await service.updateAddress(req.auth.userId, req.params.addressId, req.body)).toSafeJSON() }));
const remove = asyncHandler(async (req, res) => { await service.deleteAddress(req.auth.userId, req.params.addressId); return res.status(204).send(); });

module.exports = { list, create, update, remove };
