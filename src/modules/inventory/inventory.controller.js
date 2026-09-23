const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const { AppError } = require('../../common/errors/AppError');
const { canAccessLocation } = require('../../middleware/business-access');
const service = require('./inventory.service');

function assertLocations(req, locationIds) {
  for (const locationId of locationIds.filter(Boolean)) if (!canAccessLocation(req.businessMembership, locationId)) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'You do not have access to one of the selected business locations');
}

const positions = asyncHandler(async (req, res) => { assertLocations(req, [req.query.locationId]); return sendSuccess(res, await service.listPositions({ businessId: req.business._id, ...req.query })); });
const transfer = asyncHandler(async (req, res) => { assertLocations(req, [req.body.sourceLocationId, req.body.destinationLocationId]); const item = await service.transferStock({ ...req.body, businessId: req.business._id, actorId: req.auth.userId }); return res.status(201).json({ success: true, data: { transfer: item.toSafeJSON() } }); });

module.exports = { positions, transfer };
