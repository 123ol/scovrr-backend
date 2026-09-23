const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const { Service } = require('../services/service.model');
const service = require('./availability.service');

const getRule = asyncHandler(async (req, res) => sendSuccess(res, { availability: await service.getAvailabilityRule(req.business._id, req.query.staffUserId || null, req.query.locationId || null) }));
const saveRule = asyncHandler(async (req, res) => sendSuccess(res, { availability: await service.saveAvailability(req.business._id, req.body) }));
const createBlock = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { block: await service.createBlockedPeriod(req.business._id, req.body) } }));
const listBlocks = asyncHandler(async (req, res) => sendSuccess(res, { blocks: await service.listBlockedPeriods(req.business._id, null, new Date(), new Date(Date.now() + 366 * 86_400_000), req.query.locationId || null) }));
const deleteBlock = asyncHandler(async (req, res) => sendSuccess(res, { block: await service.deleteBlockedPeriod(req.business._id, req.params.blockId) }));

const publicSlots = asyncHandler(async (req, res) => {
  const item = await Service.findOne({ _id: req.query.serviceId, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!item || !item.businessId || item.businessId.status !== 'active' || item.businessId.moderationStatus !== 'approved') return res.status(404).json({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' } });
  if (req.query.staffUserId && !item.staffUserIds.some((staffId) => staffId.toString() === req.query.staffUserId)) return res.status(404).json({ success: false, error: { code: 'SERVICE_STAFF_NOT_FOUND', message: 'The selected professional is not assigned to this service' } });
  if (req.query.locationId && item.locationIds.length && !item.locationIds.some((id) => id.toString() === req.query.locationId)) return res.status(404).json({ success: false, error: { code: 'SERVICE_LOCATION_NOT_FOUND', message: 'The selected branch does not offer this service' } });
  const locationId = req.query.locationId || null;
  const eligibleStaff = item.staffUserIds.filter((staffId) => {
    const assignment = item.staffAssignments.find((entry) => entry.staffUserId.toString() === staffId.toString());
    return !assignment || !assignment.locationIds.length || !locationId || assignment.locationIds.some((id) => id.toString() === locationId);
  }).map((id) => id.toString());
  const staffIds = req.query.staffUserId ? [req.query.staffUserId] : (eligibleStaff.length ? eligibleStaff : [null]);
  const slotGroups = await Promise.all(staffIds.map((staffUserId) => service.getAvailableSlots({ businessId: item.businessId._id, locationId, service: item, variantId: req.query.variantId, staffUserId, from: req.query.from, to: req.query.to })));
  const slots = slotGroups.flat().sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  return sendSuccess(res, { service: item.toPublicJSON(), business: { id: item.businessId._id.toString(), name: item.businessId.name, slug: item.businessId.slug }, slots });
});

module.exports = { getRule, saveRule, createBlock, listBlocks, deleteBlock, publicSlots };
