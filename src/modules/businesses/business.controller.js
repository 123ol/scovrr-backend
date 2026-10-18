const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const businessService = require('./business.service');
const businessRiskService = require('./business-risk.service');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');
const { BusinessLocation } = require('./business-location.model');

const create = asyncHandler(async (req, res) => {
  const business = await businessService.createBusiness(req.auth.userId, req.body);
  return res.status(201).json({ success: true, data: { business: business.toOwnerJSON() } });
});

const mine = asyncHandler(async (req, res) => sendSuccess(res, { businesses: await businessService.listUserBusinesses(req.auth.userId) }));

const publicBySlug = asyncHandler(async (req, res) => {
  const business = await businessService.getPublicBusinessBySlug(req.params.slug);
  const locations = await BusinessLocation.find({ businessId: business._id, active: true, publiclyVisible: true }).sort({ primary: -1, createdAt: 1 });
  return sendSuccess(res, { business: { ...business.toPublicJSON(), storefront: await businessService.getPublicStorefront(business) }, locations: locations.map((location) => location.toJSONSafe(false)) });
});

const updateStorefront = asyncHandler(async (req, res) => {
  const business = await businessService.updateStorefront(req.business, req.body);
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const updateMessaging = asyncHandler(async (req, res) => {
  const business = await businessService.updateMessaging(req.business, req.body);
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const updateCapabilities = asyncHandler(async (req, res) => {
  const business = await businessService.updateCapabilities(req.business, req.body.capabilities);
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const addLocation = asyncHandler(async (req, res) => {
  const location = await businessService.addLocation(req.business._id, req.body);
  return res.status(201).json({ success: true, data: { location: location.toJSONSafe(true) } });
});

const listLocations = asyncHandler(async (req, res) => {
  const locations = await businessService.listLocations(req.params.businessId, false);
  return sendSuccess(res, { locations });
});

const listPrivateLocations = asyncHandler(async (req, res) => {
  const locations = await businessService.listLocations(req.params.businessId, true);
  return sendSuccess(res, { locations });
});

const updateLocation = asyncHandler(async (req, res) => {
  const location = await businessService.updateLocation(req.business._id, req.params.locationId, req.body);
  return sendSuccess(res, { location: location.toJSONSafe(true) });
});

const submit = asyncHandler(async (req, res) => {
  const business = await businessService.submitBusiness(req.business);
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const attachVerificationEvidence = asyncHandler(async (req, res) => {
  const business = await businessService.attachVerificationEvidence(req.business, req.auth.userId, req.body.evidenceAssetIds);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.VERIFICATION_EVIDENCE_ATTACHED, targetType: 'business', targetId: business._id, metadata: { evidenceCount: req.body.evidenceAssetIds.length }, ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const adminList = asyncHandler(async (req, res) => {
  const result = await businessService.listBusinessesForAdmin(req.query);
  return sendSuccess(res, { ...result, businesses: result.businesses.map((business) => business.toOwnerJSON()) });
});
const adminDetail = asyncHandler(async (req, res) => {
  const detail = await businessService.getAdminDetail(req.params.businessId);
  return sendSuccess(res, { business: detail.business.toOwnerJSON(), locations: detail.locations.map((location) => location.toJSONSafe(true)), members: detail.members.map((member) => ({ ...member.toJSONSafe(), user: member.userId ? { id: member.userId._id.toString(), firstName: member.userId.firstName, lastName: member.userId.lastName, email: member.userId.email, status: member.userId.status } : null })), counts: detail.counts });
});
const adminRisk = asyncHandler(async (req, res) => sendSuccess(res, await businessRiskService.listRiskSignals(req.query)));

const adminApprove = asyncHandler(async (req, res) => {
  const business = await businessService.reviewBusiness(req.params.businessId, req.auth.userId, 'approve');
  await recordAudit({ actorId: req.auth.userId, action: 'VERIFICATION_APPROVED', targetType: 'business', targetId: business._id, after: business.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const adminReject = asyncHandler(async (req, res) => {
  const business = await businessService.reviewBusiness(req.params.businessId, req.auth.userId, 'reject', req.body);
  await recordAudit({ actorId: req.auth.userId, action: 'VERIFICATION_REJECTED', targetType: 'business', targetId: business._id, reason: req.body.reason, after: business.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { business: business.toOwnerJSON() });
});
const adminRequestInformation = asyncHandler(async (req, res) => {
  const business = await businessService.reviewBusiness(req.params.businessId, req.auth.userId, 'request_information', req.body);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.VERIFICATION_INFORMATION_REQUESTED, targetType: 'business', targetId: business._id, reason: req.body.reason, after: business.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { business: business.toOwnerJSON() });
});

const adminSuspend = asyncHandler(async (req, res) => {
  const result = await businessService.changeAdminStatus(req.params.businessId, req.auth.userId, 'suspended', req.body.reason);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.BUSINESS_SUSPENDED, targetType: 'business', targetId: result.business._id, reason: req.body.reason, before: result.before, after: result.business.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { business: result.business.toOwnerJSON() });
});

const adminReactivate = asyncHandler(async (req, res) => {
  const result = await businessService.changeAdminStatus(req.params.businessId, req.auth.userId, 'active', req.body.reason);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.BUSINESS_REACTIVATED, targetType: 'business', targetId: result.business._id, reason: req.body.reason, before: result.before, after: result.business.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { business: result.business.toOwnerJSON() });
});

module.exports = { create, mine, publicBySlug, updateStorefront, updateMessaging, updateCapabilities, addLocation, listLocations, listPrivateLocations, updateLocation, submit, attachVerificationEvidence, adminList, adminDetail, adminRisk, adminApprove, adminReject, adminRequestInformation, adminSuspend, adminReactivate };
