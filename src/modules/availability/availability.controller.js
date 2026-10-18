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
  const requestedServiceIds = [...new Set([req.query.serviceId, ...(req.query.serviceIds ? req.query.serviceIds.split(',') : [])])];
  const foundServices = await Service.find({ _id: { $in: requestedServiceIds }, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  const byId = new Map(foundServices.map((serviceItem) => [serviceItem._id.toString(), serviceItem]));
  const item = byId.get(req.query.serviceId);
  if (!item || !item.businessId || item.businessId.status !== 'active' || item.businessId.moderationStatus !== 'approved') return res.status(404).json({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' } });
  const services = requestedServiceIds.map((serviceId) => byId.get(serviceId));
  if (services.some((serviceItem) => !serviceItem || serviceItem.businessId._id.toString() !== item.businessId._id.toString())) return res.status(409).json({ success: false, error: { code: 'BOOKING_BUSINESS_MISMATCH', message: 'Availability bundles must use services from one business' } });
  if (services.length > 1 && services.slice(1).some((serviceItem) => serviceItem.variants.length > 0)) return res.status(409).json({ success: false, error: { code: 'SERVICE_VARIANT_REQUIRED', message: 'Choose options for each additional service before checking bundle availability' } });
  if (req.query.staffUserId && services.some((serviceItem) => !serviceItem.staffUserIds.some((staffId) => staffId.toString() === req.query.staffUserId))) return res.status(404).json({ success: false, error: { code: 'SERVICE_STAFF_NOT_FOUND', message: 'The selected professional is not assigned to every service' } });
  if (req.query.locationId && services.some((serviceItem) => serviceItem.locationIds.length && !serviceItem.locationIds.some((id) => id.toString() === req.query.locationId))) return res.status(404).json({ success: false, error: { code: 'SERVICE_LOCATION_NOT_FOUND', message: 'The selected branch does not offer every service' } });
  const locationId = req.query.locationId || null;
  const eligibleByService = services.map((serviceItem) => serviceItem.staffUserIds.filter((staffId) => {
    const assignment = serviceItem.staffAssignments.find((entry) => entry.staffUserId.toString() === staffId.toString());
    return !assignment || !assignment.locationIds.length || !locationId || assignment.locationIds.some((id) => id.toString() === locationId);
  }).map((id) => id.toString()));
  const constrained = eligibleByService.filter((ids) => ids.length);
  const commonStaff = constrained.length ? constrained.slice(1).reduce((common, ids) => common.filter((id) => ids.includes(id)), [...constrained[0]]) : [];
  if (!req.query.staffUserId && constrained.length && !commonStaff.length) return res.status(404).json({ success: false, error: { code: 'SERVICE_STAFF_NOT_FOUND', message: 'No professional is assigned to every service' } });
  const staffIds = req.query.staffUserId ? [req.query.staffUserId] : (commonStaff.length ? commonStaff : [null]);
  const selectedSnapshots = services.map((serviceItem, index) => serviceItem.toSnapshot(index === 0 ? (req.query.variantId || null) : null));
  const durationMinutes = selectedSnapshots.reduce((total, snapshot, index) => total + snapshot.durationMinutes + (index > 0 ? snapshot.bufferBeforeMinutes : 0) + (index < selectedSnapshots.length - 1 ? snapshot.bufferAfterMinutes : 0), 0);
  if (new Set(selectedSnapshots.map((snapshot) => snapshot.currency)).size !== 1) return res.status(409).json({ success: false, error: { code: 'BOOKING_CURRENCY_MISMATCH', message: 'All appointment services must use the same currency' } });
  const bundleService = { variants: [], durationMinutes, bufferBeforeMinutes: selectedSnapshots[0].bufferBeforeMinutes, bufferAfterMinutes: selectedSnapshots.at(-1).bufferAfterMinutes, minNoticeMinutes: Math.max(...services.map((serviceItem) => serviceItem.minNoticeMinutes || 0)), maxAdvanceDays: Math.min(...services.map((serviceItem) => serviceItem.maxAdvanceDays || 730)) };
  const slotGroups = await Promise.all(staffIds.map((staffUserId) => service.getAvailableSlots({ businessId: item.businessId._id, locationId, service: bundleService, staffUserId, from: req.query.from, to: req.query.to })));
  const slots = slotGroups.flat().sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  return sendSuccess(res, { service: item.toPublicJSON(), services: services.map((serviceItem) => serviceItem.toCardJSON()), bundle: services.length > 1 ? { serviceIds: services.map((serviceItem) => serviceItem._id.toString()), durationMinutes, currency: selectedSnapshots[0].currency, priceMinor: selectedSnapshots.reduce((sum, snapshot) => sum + snapshot.priceMinor, 0) } : null, business: { id: item.businessId._id.toString(), name: item.businessId.name, slug: item.businessId.slug }, slots });
});

module.exports = { getRule, saveRule, createBlock, listBlocks, deleteBlock, publicSlots };
