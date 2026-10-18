const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { Report } = require('./report.model');
const { Business } = require('../businesses/business.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Review } = require('../reviews/review.model');
const { User } = require('../users/user.model');
const { Message } = require('../conversations/message.model');
const { Conversation } = require('../conversations/conversation.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { ContentPost } = require('../content-posts/content-post.model');
const moderationService = require('../moderation/moderation.service');
const { OperationalNote } = require('../operations/operational-note.model');
const { AuditLog } = require('../audit/audit-log.model');
const businessRiskService = require('../businesses/business-risk.service');
const { assertUserCanActById } = require('../users/user-status.service');

const SUBJECT_MODELS = { business: Business, product: Product, service: Service, content_post: ContentPost, review: Review, user: User, message: Message, conversation: Conversation, order: Order, booking: Booking };
const MODERATION_SUBJECTS = new Set(['business', 'product', 'service', 'content_post', 'review']);
const ACTIVE_STATUSES = ['open', 'in_review', 'action_required'];

function reportNumber() { return `SCV-RPT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function idOf(value) { return value?._id?.toString() || value?.toString() || null; }
function defaultPriority(reason) {
  if (['counterfeit', 'fraud', 'safety', 'prohibited_goods', 'support_escalation'].includes(reason)) return 'high';
  if (['harassment', 'inappropriate_media'].includes(reason)) return 'normal';
  return 'low';
}
function priorityRank(priority) { return { low: 1, normal: 2, high: 3, critical: 4 }[priority] || 0; }

function investigationReportJSON(report) {
  const safe = report.toSafeJSON({ audience: 'admin' });
  return {
    id: safe.id,
    reportNumber: safe.reportNumber,
    subjectType: safe.subjectType,
    subjectId: safe.subjectId,
    businessId: safe.businessId,
    reason: safe.reason,
    status: safe.status,
    priority: safe.priority,
    resolution: safe.resolution,
    createdAt: safe.createdAt,
    updatedAt: safe.updatedAt
  };
}

function summarizeInvestigationReports(reports = []) {
  const statuses = {}; const reasons = {}; let highPriority = 0;
  const reporters = new Set();
  reports.forEach((report) => {
    statuses[report.status] = (statuses[report.status] || 0) + 1;
    reasons[report.reason] = (reasons[report.reason] || 0) + 1;
    if (['high', 'critical'].includes(report.priority)) highPriority += 1;
    if (report.reporterId) reporters.add(idOf(report.reporterId));
  });
  return { total: reports.length, active: reports.filter((report) => ACTIVE_STATUSES.includes(report.status)).length, highPriority, uniqueReporters: reporters.size, statuses, reasons };
}

async function resolveSubject(userId, input) {
  if (!mongoose.isValidObjectId(input.subjectId)) throw new AppError(400, 'INVALID_REPORT_SUBJECT', 'The reported subject is invalid');
  if (input.subjectType === 'user' && input.subjectId === userId) throw new AppError(400, 'INVALID_REPORT_SUBJECT', 'You cannot report your own account');
  const Model = SUBJECT_MODELS[input.subjectType];
  if (!Model) throw new AppError(400, 'INVALID_REPORT_SUBJECT_TYPE', 'This subject type cannot be reported');
  const subject = await Model.findById(input.subjectId);
  if (!subject) throw new AppError(404, 'REPORT_SUBJECT_NOT_FOUND', 'The item being reported could not be found');
  if (input.subjectType === 'review' && subject.status !== 'approved') throw new AppError(404, 'REPORT_SUBJECT_NOT_VISIBLE', 'This review is not currently reportable');
  if (input.subjectType === 'content_post' && (subject.status !== 'active' || subject.moderationStatus !== 'approved')) throw new AppError(404, 'REPORT_SUBJECT_NOT_VISIBLE', 'This post is not currently reportable');
  let businessId = null;
  if (['product', 'service', 'content_post', 'review'].includes(input.subjectType)) businessId = subject.businessId;
  if (input.subjectType === 'business') businessId = subject._id;
  if (input.subjectType === 'message') {
    const conversation = await Conversation.findOne({ _id: subject.conversationId, participantIds: userId });
    if (!conversation) throw new AppError(403, 'REPORT_SUBJECT_ACCESS_REQUIRED', 'You may only report a message from a conversation you can access');
  }
  if (input.subjectType === 'conversation' && !subject.participantIds.some((participantId) => participantId.toString() === userId.toString())) throw new AppError(403, 'REPORT_SUBJECT_ACCESS_REQUIRED', 'You may only report a conversation you can access');
  if (['order', 'booking'].includes(input.subjectType)) {
    if (subject.customerId?.toString() !== userId.toString()) throw new AppError(403, 'REPORT_SUBJECT_ACCESS_REQUIRED', 'You may only report your own transaction');
  }
  return { subject, businessId: idOf(businessId) };
}

async function createReport(userId, input) {
  await assertUserCanActById(userId);
  if (input.reason === 'support_escalation' && input.subjectType !== 'conversation') throw new AppError(400, 'INVALID_SUPPORT_ESCALATION', 'Support escalation must reference a conversation');
  const { subject, businessId } = await resolveSubject(userId, input);
  const activeExisting = await Report.exists({ reporterId: userId, subjectType: input.subjectType, subjectId: input.subjectId, status: { $in: ACTIVE_STATUSES } });
  if (activeExisting) throw new AppError(409, 'REPORT_ALREADY_OPEN', 'You already have an open report for this item');
  const report = await Report.create({ reportNumber: reportNumber(), reporterId: userId, subjectType: input.subjectType, subjectId: subject._id, businessId, reason: input.reason, details: input.details || '', priority: defaultPriority(input.reason), status: 'open' });
  if (input.evidenceAssetIds?.length) {
    const { attachEvidence } = require('../evidence/evidence.service');
    report.evidence = await attachEvidence({ userId, purpose: 'report', subject: { id: report._id, subjectType: input.subjectType, subjectId: subject._id }, evidenceAssetIds: input.evidenceAssetIds });
    await report.save();
  }
  if (MODERATION_SUBJECTS.has(input.subjectType)) {
    const item = await moderationService.createOrAttachCase({ subjectType: input.subjectType, subjectId: subject._id, businessId, source: 'report', sourceReportId: report._id, reason: input.reason, severity: moderationService.severityForReason(input.reason) });
    report.moderationCaseId = item._id;
    await report.save();
  }
  return report;
}

async function getReporterReport(userId, reportId) {
  const report = await Report.findOne({ _id: reportId, reporterId: userId });
  if (!report) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  return report;
}

async function listReporterReports(userId, query = { page: 1, limit: 20 }) {
  const filter = { reporterId: userId };
  const skip = (query.page - 1) * query.limit;
  const [reports, total] = await Promise.all([Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Report.countDocuments(filter)]);
  return { reports: reports.map((report) => report.toSafeJSON({ includeEvidence: true })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listAdminReports(query) {
  const filter = {
    ...(query.status ? { status: query.status } : {}), ...(query.subjectType ? { subjectType: query.subjectType } : {}), ...(query.reason ? { reason: query.reason } : {}),
    ...(query.priority ? { priority: query.priority } : {}), ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}), ...(query.businessId ? { businessId: query.businessId } : {}), ...(query.reporterId ? { reporterId: query.reporterId } : {}),
    ...((query.from || query.to) ? { createdAt: { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lt: new Date(query.to) } : {}) } } : {})
  };
  const skip = (query.page - 1) * query.limit;
  const [reportRows, total] = await Promise.all([
    Report.aggregate([{ $match: filter }, { $addFields: { _priorityRank: { $indexOfArray: [['low', 'normal', 'high', 'critical'], '$priority'] } } }, { $sort: { _priorityRank: -1, createdAt: -1 } }, { $skip: skip }, { $limit: query.limit }]),
    Report.countDocuments(filter)
  ]);
  const reports = reportRows.map((row) => Report.hydrate(row));
  await Report.populate(reports, [{ path: 'reporterId', select: 'firstName lastName email' }, { path: 'assignedAdminId', select: 'firstName lastName email' }]);
  return { reports: reports.map((report) => ({ ...report.toSafeJSON({ audience: 'admin' }), reporter: report.reporterId?.email ? { id: report.reporterId._id.toString(), firstName: report.reporterId.firstName, lastName: report.reporterId.lastName, email: report.reporterId.email } : null, assignedAdmin: report.assignedAdminId?.email ? { id: report.assignedAdminId._id.toString(), firstName: report.assignedAdminId.firstName, lastName: report.assignedAdminId.lastName, email: report.assignedAdminId.email } : null })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getAdminReport(reportId) {
  const report = await Report.findById(reportId).populate('reporterId', 'firstName lastName email').populate('assignedAdminId', 'firstName lastName email');
  if (!report) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  const notes = await OperationalNote.find({ subjectType: 'report', subjectId: report._id }).sort({ createdAt: -1 }).limit(100).populate('authorAdminId', 'firstName lastName email');
  return { report, notes };
}

async function getAdminInvestigation(reportId) {
  const report = await Report.findById(reportId);
  if (!report) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  const scope = [{ subjectType: report.subjectType, subjectId: report.subjectId }];
  if (report.businessId) scope.push({ businessId: report.businessId });
  if (report.reporterId) scope.push({ reporterId: report.reporterId });
  const relatedReports = await Report.find({ _id: { $ne: report._id }, $or: scope }).sort({ createdAt: -1 }).limit(100);
  const allReports = [report, ...relatedReports];
  const [risk, moderation, audits] = await Promise.all([
    report.businessId ? businessRiskService.listRiskSignals({ businessId: report.businessId.toString(), page: 1, limit: 1 }) : Promise.resolve({ businesses: [] }),
    report.moderationCaseId ? moderationService.getAdminCase(report.moderationCaseId) : Promise.resolve(null),
    AuditLog.find({ $or: [{ targetType: 'report', targetId: report._id }, ...(report.moderationCaseId ? [{ targetType: 'moderation_case', targetId: report.moderationCaseId }] : [])] }).sort({ createdAt: -1 }).limit(100).populate('actorId', 'firstName lastName email')
  ]);
  const related = relatedReports.map((item) => ({ ...investigationReportJSON(item), scopes: [
    item.subjectType === report.subjectType && item.subjectId.toString() === report.subjectId.toString() ? 'same_subject' : null,
    report.businessId && item.businessId?.toString() === report.businessId.toString() ? 'same_business' : null,
    item.reporterId?.toString() === report.reporterId?.toString() ? 'same_reporter' : null
  ].filter(Boolean) }));
  return {
    report: investigationReportJSON(report),
    summary: summarizeInvestigationReports(allReports),
    relatedReports: related,
    sellerRisk: risk.businesses[0] || null,
    moderationCase: moderation ? {
      moderationCase: moderation.case.toSafeJSON(),
      subject: moderation.subject,
      reports: moderation.reports.map((item) => investigationReportJSON(item)),
      notes: moderation.notes.map((item) => item.toSafeJSON())
    } : null,
    audit: audits.map((item) => ({ ...item.toSafeJSON(), actor: item.actorId?.email ? { id: item.actorId._id.toString(), firstName: item.actorId.firstName, lastName: item.actorId.lastName, email: item.actorId.email } : null }))
  };
}

async function addEvidence(userId, reportId, evidenceAssetIds) {
  await assertUserCanActById(userId);
  const report = await Report.findOne({ _id: reportId, reporterId: userId, status: { $in: ACTIVE_STATUSES } });
  if (!report) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found or no longer accepts evidence');
  const { attachEvidence } = require('../evidence/evidence.service');
  const snapshots = await attachEvidence({ userId, purpose: 'report', subject: { id: report._id, subjectType: report.subjectType, subjectId: report.subjectId }, evidenceAssetIds });
  report.evidence.push(...snapshots); await report.save();
  return report;
}

async function addNote(adminId, reportId, body) {
  if (!await Report.exists({ _id: reportId })) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  return OperationalNote.create({ subjectType: 'report', subjectId: reportId, authorAdminId: adminId, body });
}

async function assignReport(reportId, adminId, assignedAdminId = adminId) {
  const assignee = await User.findOne({ _id: assignedAdminId, status: 'active', adminRoles: { $exists: true, $ne: [] } }).select('_id');
  if (!assignee) throw new AppError(400, 'INVALID_REPORT_ASSIGNEE', 'Reports can only be assigned to active administrators');
  const report = await Report.findOne({ _id: reportId, status: { $in: ACTIVE_STATUSES } });
  if (!report) throw new AppError(409, 'REPORT_NOT_ASSIGNABLE', 'This report is not available for assignment');
  report.assignedAdminId = assignedAdminId;
  if (report.status === 'open') report.status = 'in_review';
  await report.save();
  return report;
}

async function setPriority(reportId, priority) {
  const report = await Report.findById(reportId);
  if (!report) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  if (!ACTIVE_STATUSES.includes(report.status)) throw new AppError(409, 'REPORT_CLOSED', 'Closed reports cannot be reprioritized');
  const before = report.toSafeJSON({ audience: 'admin' }); report.priority = priority; await report.save(); return { report, before };
}

async function startReview(reportId, adminId, note = '') {
  const report = await Report.findOne({ _id: reportId, status: { $in: ['open', 'action_required'] } });
  if (!report) throw new AppError(409, 'REPORT_NOT_REVIEWABLE', 'This report is not available to start review');
  const before = report.toSafeJSON({ audience: 'admin' }); report.status = 'in_review'; report.assignedAdminId = report.assignedAdminId || adminId; report.resolution = note || report.resolution; await report.save(); return { report, before };
}

async function escalateReport(reportId, adminId, reason) {
  const report = await Report.findOne({ _id: reportId, status: { $in: ACTIVE_STATUSES } });
  if (!report) throw new AppError(409, 'REPORT_NOT_ESCALATABLE', 'This report is no longer active');
  const before = report.toSafeJSON({ audience: 'admin' });
  report.status = 'action_required';
  report.priority = 'critical';
  report.escalation = { reason, escalatedBy: adminId, escalatedAt: new Date() };
  await report.save();
  return { report, before };
}

async function resolveReport(reportId, adminId, input) {
  const report = await Report.findById(reportId);
  if (!report) throw new AppError(404, 'REPORT_NOT_FOUND', 'Report not found');
  const targetStatus = input.status === 'rejected' ? 'dismissed' : input.status;
  if (!['resolved', 'dismissed', 'action_required'].includes(targetStatus)) throw new AppError(400, 'INVALID_REPORT_RESOLUTION', 'This report resolution is not supported');
  if (!ACTIVE_STATUSES.includes(report.status)) {
    if (report.status === targetStatus) return { report, before: report.toSafeJSON({ audience: 'admin' }) };
    throw new AppError(409, 'REPORT_CLOSED', 'This report has already been resolved');
  }
  const before = report.toSafeJSON({ audience: 'admin' }); report.status = targetStatus; report.resolution = input.resolution;
  if (['resolved', 'dismissed'].includes(targetStatus)) { report.resolvedBy = adminId; report.resolvedAt = new Date(); }
  await report.save(); return { report, before };
}

module.exports = { reportNumber, createReport, resolveSubject, getReporterReport, listReporterReports, listAdminReports, getAdminReport, getAdminInvestigation, addEvidence, addNote, assignReport, setPriority, startReview, escalateReport, resolveReport, defaultPriority, priorityRank, investigationReportJSON, summarizeInvestigationReports };
