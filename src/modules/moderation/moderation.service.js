const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { ModerationCase, MODERATION_STATUSES } = require('./moderation-case.model');
const { ModerationAppeal, MODERATION_APPEAL_STATUSES } = require('./moderation-appeal.model');
const { ModerationCaseReport } = require('./moderation-case-report.model');
const { OperationalNote } = require('../operations/operational-note.model');
const { Report } = require('../reports/report.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Business } = require('../businesses/business.model');
const { Review } = require('../reviews/review.model');
const { ContentPost } = require('../content-posts/content-post.model');
const { User } = require('../users/user.model');
const { refreshAggregates } = require('../reviews/review.service');

const SUBJECT_MODELS = { business: Business, product: Product, service: Service, content_post: ContentPost, review: Review };
const ACTIVE_STATUSES = ['pending', 'under_review', 'action_required'];

function caseNumber() {
  return `SCV-MOD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function activeSubjectKey(subjectType, subjectId) { return `${subjectType}:${subjectId.toString()}`; }

function idOf(value) { return value?._id?.toString() || value?.toString() || null; }

function severityForReason(reason) {
  if (['counterfeit', 'fraud', 'safety', 'prohibited_goods'].includes(reason)) return 'high';
  if (['harassment', 'inappropriate_media'].includes(reason)) return 'medium';
  return 'low';
}
function severityRank(severity) { return { low: 1, medium: 2, high: 3, critical: 4 }[severity] || 0; }

async function createOrAttachCase(input) {
  if (!mongoose.isValidObjectId(input.subjectId)) throw new AppError(400, 'INVALID_MODERATION_SUBJECT', 'The moderation subject is invalid');
  const key = activeSubjectKey(input.subjectType, input.subjectId);
  let item = await ModerationCase.findOne({ activeSubjectKey: key, status: { $in: ACTIVE_STATUSES } });
  if (!item) {
    try {
      item = await ModerationCase.create({
        caseNumber: caseNumber(), subjectType: input.subjectType, subjectId: input.subjectId,
        activeSubjectKey: key, businessId: input.businessId || null, source: input.source || 'report',
        sourceReportId: input.sourceReportId || null, reason: input.reason, severity: input.severity || severityForReason(input.reason)
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      item = await ModerationCase.findOne({ activeSubjectKey: key, status: { $in: ACTIVE_STATUSES } });
      if (!item) throw error;
    }
  }
  if (input.sourceReportId) {
    await ModerationCaseReport.updateOne({ caseId: item._id, reportId: input.sourceReportId }, { $setOnInsert: { caseId: item._id, reportId: input.sourceReportId } }, { upsert: true });
    await Report.updateOne({ _id: input.sourceReportId }, { $set: { moderationCaseId: item._id } });
  }
  if (['high', 'critical'].includes(input.severity) && item.severity === 'low') {
    item.severity = input.severity;
    await item.save();
  }
  return item;
}

async function getSubject(caseItem) {
  const Model = SUBJECT_MODELS[caseItem.subjectType];
  if (!Model) return null;
  const subject = await Model.findById(caseItem.subjectId);
  if (!subject) return null;
  if (caseItem.subjectType === 'product' && subject.toOwnerJSON) return subject.toOwnerJSON();
  if (caseItem.subjectType === 'service' && subject.toOwnerJSON) return subject.toOwnerJSON();
  if (caseItem.subjectType === 'content_post' && subject.toOwnerJSON) return subject.toOwnerJSON();
  if (caseItem.subjectType === 'business' && subject.toOwnerJSON) return subject.toOwnerJSON();
  if (caseItem.subjectType === 'review' && subject.toSafeJSON) return subject.toSafeJSON();
  return { id: idOf(subject) };
}

async function listAdminCases(query) {
  const filter = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.subjectType ? { subjectType: query.subjectType } : {}),
    ...(query.source ? { source: query.source } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.assignedModeratorId ? { assignedModeratorId: query.assignedModeratorId } : {}),
    ...((query.from || query.to) ? { createdAt: { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lt: new Date(query.to) } : {}) } } : {})
  };
  const skip = (query.page - 1) * query.limit;
  const [itemRows, total] = await Promise.all([
    ModerationCase.aggregate([{ $match: filter }, { $addFields: { _severityRank: { $indexOfArray: [['low', 'medium', 'high', 'critical'], '$severity'] } } }, { $sort: { _severityRank: -1, createdAt: -1 } }, { $skip: skip }, { $limit: query.limit }]),
    ModerationCase.countDocuments(filter)
  ]);
  const items = itemRows.map((row) => ModerationCase.hydrate(row));
  await ModerationCase.populate(items, { path: 'assignedModeratorId', select: 'firstName lastName email' });
  return {
    cases: items.map((item) => ({ ...item.toSafeJSON(), assignedModerator: item.assignedModeratorId?.email ? { id: item.assignedModeratorId._id.toString(), firstName: item.assignedModeratorId.firstName, lastName: item.assignedModeratorId.lastName, email: item.assignedModeratorId.email } : null })),
    total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit)
  };
}

async function listModerationAssignees() {
  const [admins, workload] = await Promise.all([
    User.find({ status: 'active', adminRoles: { $in: ['moderator', 'moderation', 'operations', 'super_admin'] } }).select('firstName lastName email adminRoles').sort({ firstName: 1, lastName: 1, email: 1 }).limit(100).lean(),
    ModerationCase.aggregate([
      { $match: { status: { $in: ACTIVE_STATUSES }, assignedModeratorId: { $ne: null } } },
      { $group: { _id: '$assignedModeratorId', activeCases: { $sum: 1 } } }
    ])
  ]);
  const counts = new Map(workload.map((item) => [item._id.toString(), item.activeCases]));
  return admins.map((admin) => ({ id: admin._id.toString(), firstName: admin.firstName, lastName: admin.lastName, email: admin.email, roles: admin.adminRoles, activeCases: counts.get(admin._id.toString()) || 0 }));
}

async function getAdminCase(caseId) {
  const item = await ModerationCase.findById(caseId).populate('assignedModeratorId', 'firstName lastName email');
  if (!item) throw new AppError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found');
  const [reports, notes, subject] = await Promise.all([
    Report.find({ moderationCaseId: item._id }).sort({ createdAt: -1 }).limit(100).populate('reporterId', 'firstName lastName email'),
    OperationalNote.find({ subjectType: 'moderation_case', subjectId: item._id }).sort({ createdAt: -1 }).limit(100).populate('authorAdminId', 'firstName lastName email'),
    getSubject(item)
  ]);
  return { case: item, reports, notes, subject };
}

async function assignCase(caseId, adminId, assignedModeratorId = adminId) {
  const assignee = await User.findOne({ _id: assignedModeratorId, status: 'active', adminRoles: { $exists: true, $ne: [] } }).select('_id');
  if (!assignee) throw new AppError(400, 'INVALID_MODERATION_ASSIGNEE', 'Cases can only be assigned to active administrators');
  const item = await ModerationCase.findOne({ _id: caseId, status: { $in: ACTIVE_STATUSES } });
  if (!item) throw new AppError(409, 'MODERATION_CASE_NOT_ASSIGNABLE', 'This moderation case is not available for assignment');
  item.assignedModeratorId = assignedModeratorId;
  if (item.status === 'pending') item.status = 'under_review';
  await item.save();
  return item;
}

async function applySubjectDecision(item, outcome, note) {
  const Model = SUBJECT_MODELS[item.subjectType];
  if (!Model) return null;
  const subject = await Model.findById(item.subjectId);
  if (!subject) throw new AppError(404, 'MODERATION_SUBJECT_NOT_FOUND', 'The moderated content no longer exists');
  if (item.subjectType === 'product' || item.subjectType === 'service' || item.subjectType === 'content_post') {
    if (outcome === 'approved') {
      if (item.subjectType === 'service' || item.subjectType === 'content_post') {
        const business = await Business.findOne({ _id: subject.businessId, status: 'active', moderationStatus: 'approved' }).select('_id');
        if (!business) throw new AppError(409, 'BUSINESS_NOT_READY_FOR_CONTENT', 'The parent business must be active and approved before content can be published');
      }
      subject.moderationStatus = 'approved';
      subject.rejectionReason = null;
      const priorStatus = item.decision?.subjectStatusBefore;
      if (priorStatus === 'archived' || priorStatus === 'draft') subject.status = priorStatus;
      else if (['pending_review', 'rejected', 'archived'].includes(subject.status) || priorStatus) { subject.status = 'active'; subject.publishedAt = subject.publishedAt || new Date(); }
    } else if (outcome === 'rejected') {
      subject.moderationStatus = 'rejected'; subject.rejectionReason = note;
      if (subject.status !== 'archived') subject.status = 'rejected';
    } else if (outcome === 'removed') {
      subject.moderationStatus = 'removed'; subject.rejectionReason = note; subject.status = 'archived';
    }
    await subject.save();
  } else if (item.subjectType === 'review') {
    if (['approved', 'rejected', 'removed'].includes(outcome)) {
      subject.status = outcome;
      await subject.save();
      await refreshAggregates(subject.targetType, subject.targetType === 'product' ? subject.productId : subject.serviceId);
    }
  } else if (item.subjectType === 'business' && ['approved', 'rejected', 'removed'].includes(outcome)) {
    subject.moderationStatus = outcome;
    await subject.save();
  }
  return subject;
}

async function decideCase(caseId, adminId, outcome, note) {
  if (!MODERATION_STATUSES.includes(outcome) || !['approved', 'rejected', 'removed', 'dismissed', 'action_required'].includes(outcome)) throw new AppError(400, 'INVALID_MODERATION_DECISION', 'This moderation decision is not supported');
  const item = await ModerationCase.findById(caseId);
  if (!item) throw new AppError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found');
  if (!ACTIVE_STATUSES.includes(item.status)) {
    if (item.status === outcome) return item;
    throw new AppError(409, 'MODERATION_CASE_CLOSED', 'This moderation case has already been decided');
  }
  const before = item.toSafeJSON();
  const moderatedSubject = SUBJECT_MODELS[item.subjectType] ? await SUBJECT_MODELS[item.subjectType].findById(item.subjectId).select('status moderationStatus') : null;
  if (['approved', 'rejected', 'removed'].includes(outcome)) await applySubjectDecision(item, outcome, note);
  item.status = outcome;
  item.decision = { outcome, note, decidedBy: adminId, decidedAt: new Date(), subjectStatusBefore: moderatedSubject?.status || null, subjectModerationStatusBefore: moderatedSubject?.moderationStatus || null };
  item.resolvedAt = ['action_required'].includes(outcome) ? null : new Date();
  if (outcome !== 'action_required') item.activeSubjectKey = null;
  await item.save();
  if (outcome !== 'action_required') {
    await Report.updateMany({ moderationCaseId: item._id, status: { $in: ACTIVE_STATUSES } }, { $set: { status: outcome === 'dismissed' ? 'dismissed' : 'resolved', resolution: note, resolvedBy: adminId, resolvedAt: new Date() } });
  }
  return { item, before };
}

async function bulkDecideCases(caseIds, adminId, outcome, note) {
  const uniqueCaseIds = [...new Set(caseIds.map((caseId) => caseId.toString()))];
  const results = [];
  const failures = [];
  for (const caseId of uniqueCaseIds) {
    try {
      results.push(await decideCase(caseId, adminId, outcome, note));
    } catch (error) {
      failures.push({ caseId, code: error.code || 'MODERATION_BULK_CASE_FAILED' });
    }
  }
  return { results, failures, requested: uniqueCaseIds.length };
}

async function addNote(adminId, caseId, body) {
  const item = await ModerationCase.exists({ _id: caseId });
  if (!item) throw new AppError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found');
  return OperationalNote.create({ subjectType: 'moderation_case', subjectId: caseId, authorAdminId: adminId, body });
}

const APPEALABLE_CASE_STATUSES = ['rejected', 'removed'];
const ACTIVE_APPEAL_STATUSES = ['pending', 'under_review'];
const APPEAL_SUBJECT_MODELS = { business: Business, product: Product, service: Service, content_post: ContentPost, review: Review };

function appealNumber() { return `SCV-APL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function isAppealableCase(item) { return Boolean(item && APPEALABLE_CASE_STATUSES.includes(item.status) && APPEALABLE_CASE_STATUSES.includes(item.decision?.outcome)); }

async function appealContext(caseId, userId) {
  if (!mongoose.isValidObjectId(caseId)) throw new AppError(400, 'INVALID_MODERATION_CASE', 'The moderation case is invalid');
  const item = await ModerationCase.findById(caseId);
  if (!item) throw new AppError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found');
  if (!isAppealableCase(item)) throw new AppError(409, 'MODERATION_CASE_NOT_APPEALABLE', 'Only rejected or removed moderation decisions can be appealed');
  const Model = APPEAL_SUBJECT_MODELS[item.subjectType];
  const subject = Model ? await Model.findById(item.subjectId).select('businessId') : null;
  if (!subject) throw new AppError(404, 'MODERATION_SUBJECT_NOT_FOUND', 'The moderated content no longer exists');
  const businessId = item.subjectType === 'business' ? subject._id : subject.businessId;
  if (!businessId) throw new AppError(409, 'MODERATION_APPEAL_BUSINESS_REQUIRED', 'This moderation subject is not owned by a business');
  const membership = await require('../businesses/business-membership.model').BusinessMembership.findOne({ businessId, userId, status: 'active' }).select('role permissions');
  const permissions = new Set(membership?.permissions || []);
  const allowed = membership && (membership.role === 'owner' || membership.role === 'administrator' || permissions.has('*') || permissions.has('business.manage'));
  if (!allowed) throw new AppError(403, 'MODERATION_APPEAL_ACCESS_REQUIRED', 'Only an authorized business owner or administrator can appeal this decision');
  return { item, subject, businessId };
}

async function createAppeal(userId, caseId, reason) {
  const { item, businessId } = await appealContext(caseId, userId);
  const existing = await ModerationAppeal.findOne({ moderationCaseId: item._id, status: { $in: ACTIVE_APPEAL_STATUSES } });
  if (existing) throw new AppError(409, 'MODERATION_APPEAL_ALREADY_OPEN', 'This moderation case already has an open appeal');
  try {
    return await ModerationAppeal.create({ appealNumber: appealNumber(), moderationCaseId: item._id, activeCaseKey: item._id.toString(), appellantId: userId, businessId, subjectType: item.subjectType, subjectId: item.subjectId, reason, status: 'pending' });
  } catch (error) {
    if (error?.code === 11000) throw new AppError(409, 'MODERATION_APPEAL_ALREADY_OPEN', 'This moderation case already has an open appeal');
    throw error;
  }
}

async function listBusinessAppeals(businessId, query = {}) {
  const filter = { businessId, ...(query.status ? { status: query.status } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([ModerationAppeal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), ModerationAppeal.countDocuments(filter)]);
  return { appeals: rows.map((row) => row.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listBusinessAppealableCases(businessId) {
  const cases = await ModerationCase.find({ businessId, status: { $in: APPEALABLE_CASE_STATUSES } }).sort({ resolvedAt: -1, createdAt: -1 }).limit(100);
  const openAppeals = await ModerationAppeal.find({ moderationCaseId: { $in: cases.map((item) => item._id) }, status: { $in: ACTIVE_APPEAL_STATUSES } }).select('moderationCaseId');
  const openIds = new Set(openAppeals.map((item) => item.moderationCaseId.toString()));
  return cases.filter((item) => isAppealableCase(item) && !openIds.has(item._id.toString())).map((item) => item.toSafeJSON());
}

async function getBusinessAppeal(businessId, appealId) {
  const item = await ModerationAppeal.findOne({ _id: appealId, businessId });
  if (!item) throw new AppError(404, 'MODERATION_APPEAL_NOT_FOUND', 'Moderation appeal not found');
  return item;
}

async function listAdminAppeals(query = {}) {
  const filter = { ...(query.status ? { status: query.status } : {}), ...(query.businessId ? { businessId: query.businessId } : {}), ...(query.subjectType ? { subjectType: query.subjectType } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    ModerationAppeal.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).populate('moderationCaseId', 'caseNumber status decision').populate('businessId', 'name slug').populate('appellantId', 'firstName lastName email'),
    ModerationAppeal.countDocuments(filter)
  ]);
  return { appeals: rows.map((row) => ({ ...row.toSafeJSON(), moderationCase: row.moderationCaseId?.caseNumber ? { id: row.moderationCaseId._id.toString(), caseNumber: row.moderationCaseId.caseNumber, status: row.moderationCaseId.status, decision: row.moderationCaseId.decision } : null, business: row.businessId?.name ? { id: row.businessId._id.toString(), name: row.businessId.name, slug: row.businessId.slug } : null, appellant: row.appellantId?.email ? { id: row.appellantId._id.toString(), firstName: row.appellantId.firstName, lastName: row.appellantId.lastName, email: row.appellantId.email } : null })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getAdminAppeal(appealId) {
  const item = await ModerationAppeal.findById(appealId).populate('moderationCaseId', 'caseNumber status decision subjectType subjectId').populate('businessId', 'name slug').populate('appellantId', 'firstName lastName email');
  if (!item) throw new AppError(404, 'MODERATION_APPEAL_NOT_FOUND', 'Moderation appeal not found');
  return item;
}

async function decideAppeal(appealId, adminId, outcome, note) {
  if (!['approved', 'rejected'].includes(outcome)) throw new AppError(400, 'INVALID_MODERATION_APPEAL_DECISION', 'This moderation appeal decision is not supported');
  const appeal = await ModerationAppeal.findById(appealId);
  if (!appeal) throw new AppError(404, 'MODERATION_APPEAL_NOT_FOUND', 'Moderation appeal not found');
  if (!ACTIVE_APPEAL_STATUSES.includes(appeal.status)) {
    if (appeal.status === outcome) return appeal;
    throw new AppError(409, 'MODERATION_APPEAL_CLOSED', 'This moderation appeal has already been decided');
  }
  const moderationCase = await ModerationCase.findById(appeal.moderationCaseId);
  if (!moderationCase || !isAppealableCase(moderationCase)) throw new AppError(409, 'MODERATION_CASE_NOT_APPEALABLE', 'The original moderation decision is no longer appealable');
  if (outcome === 'approved') await applySubjectDecision(moderationCase, 'approved', note);
  appeal.status = outcome;
  appeal.decision = { outcome, note, decidedBy: adminId, decidedAt: new Date() };
  appeal.resolvedAt = new Date();
  appeal.activeCaseKey = null;
  await appeal.save();
  return appeal;
}

module.exports = { caseNumber, severityForReason, severityRank, createOrAttachCase, listAdminCases, listModerationAssignees, getAdminCase, assignCase, decideCase, bulkDecideCases, addNote, createAppeal, listBusinessAppeals, listBusinessAppealableCases, getBusinessAppeal, listAdminAppeals, getAdminAppeal, decideAppeal, isAppealableCase, applySubjectDecision, ACTIVE_STATUSES, APPEALABLE_CASE_STATUSES, ACTIVE_APPEAL_STATUSES, MODERATION_APPEAL_STATUSES };
