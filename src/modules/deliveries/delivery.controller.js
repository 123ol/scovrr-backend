const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./delivery.service');

const customer = asyncHandler(async (req, res) => sendSuccess(res, { delivery: (await service.getCustomerDelivery(req.auth.userId, req.params.orderId)).toSafeJSON() }));
const business = asyncHandler(async (req, res) => sendSuccess(res, { delivery: (await service.transition({ businessId: req.business._id, deliveryId: req.params.deliveryId, actorId: req.auth.userId, action: req.body.action, pickupCodeValue: req.body.pickupCode, estimatedPickupAt: req.body.estimatedPickupAt, courier: req.body.courier, proof: req.body.proof, membership: req.businessMembership })).toSafeJSON() }));
const businessGet = asyncHandler(async (req, res) => sendSuccess(res, { delivery: (await service.getBusinessDelivery(req.business._id, req.params.deliveryId, req.businessMembership)).toSafeJSON() }));

module.exports = { customer, business, businessGet };
