const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./home-slide.service');
const { recordAudit } = require('../audit/audit.service');

const publicList = asyncHandler(async (req, res) => sendSuccess(res, await service.listPublicHomeSlides(req.query.limit)));

const adminList = asyncHandler(async (req, res) => sendSuccess(res, await service.listAdminHomeSlides(req.query)));

const create = asyncHandler(async (req, res) => {
  const slide = await service.createHomeSlide(req.body, req.auth.userId);
  await recordAudit({ actorId: req.auth.userId, action: 'HOME_SLIDE_CREATED', targetType: 'home_slide', targetId: slide._id, after: slide.toAdminJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return res.status(201).json({ success: true, data: { slide: slide.toAdminJSON() } });
});

const update = asyncHandler(async (req, res) => {
  const slide = await service.updateHomeSlide(req.params.slideId, req.body, req.auth.userId);
  await recordAudit({ actorId: req.auth.userId, action: 'HOME_SLIDE_UPDATED', targetType: 'home_slide', targetId: slide._id, metadata: { changedFields: Object.keys(req.body) }, after: slide.toAdminJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { slide: slide.toAdminJSON() });
});

const archive = asyncHandler(async (req, res) => {
  const slide = await service.archiveHomeSlide(req.params.slideId, req.auth.userId);
  await recordAudit({ actorId: req.auth.userId, action: 'HOME_SLIDE_ARCHIVED', targetType: 'home_slide', targetId: slide._id, after: slide.toAdminJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { slide: slide.toAdminJSON() });
});

module.exports = { publicList, adminList, create, update, archive };
