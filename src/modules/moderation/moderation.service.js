const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { ModerationCase, MODERATION_STATUSES } = require('./moderation-case.model');
const { ModerationCaseReport } = require('./moderation-case-report.model');
const { OperationalNote } = require('../operations/operational-note.model');
const { Report } = require('../reports/report.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Business } = require('../businesses/business.model');
const { Review } = require('../reviews/review.model');
const { User } = require('../users/user.model');
const { refreshAggregates } = require('../reviews/review.service');

const SUBJECT_MODELS = { business: Business, product: Product, service: Service, review: Review };
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
  const [items, total] = await Promise.all([
    ModerationCase.find(filter).sort({ severity: -1, createdAt: -1 }).skip(skip).limit(query.limit).populate('assignedModeratorId', 'firstName lastName email'),
    ModerationCase.countDocuments(filter)
  ]);
  return {
    cases: items.map((item) => ({ ...item.toSafeJSON(), assignedModerator: item.assignedModeratorId?.email ? { id: item.assignedModeratorId._id.toString(), firstName: item.assignedModeratorId.firstName, lastName: item.assignedModeratorId.lastName, email: item.assignedModeratorId.email } : null })),
    total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit)
  };
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
  if (item.subjectType === 'product' || item.subjectType === 'service') {
    if (outcome === 'approved') {
      if (item.subjectType === 'service') {
        const business = await Business.findOne({ _id: subject.businessId, status: 'active', moderationStatus: 'approved' }).select('_id');
        if (!business) throw new AppError(409, 'BUSINESS_NOT_READY_FOR_SERVICE', 'The parent business must be active and approved before a service can be published');
      }
      subject.moderationStatus = 'approved';
      subject.rejectionReason = null;
      if (['pending_review', 'rejected'].includes(subject.status)) { subject.status = 'active'; subject.publishedAt = subject.publishedAt || new Date(); }
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
  if (['approved', 'rejected', 'removed'].includes(outcome)) await applySubjectDecision(item, outcome, note);
  item.status = outcome;
  item.decision = { outcome, note, decidedBy: adminId, decidedAt: new Date() };
  item.resolvedAt = ['action_required'].includes(outcome) ? null : new Date();
  if (outcome !== 'action_required') item.activeSubjectKey = null;
  await item.save();
  if (outcome !== 'action_required') {
    await Report.updateMany({ moderationCaseId: item._id, status: { $in: ACTIVE_STATUSES } }, { $set: { status: outcome === 'dismissed' ? 'dismissed' : 'resolved', resolution: note, resolvedBy: adminId, resolvedAt: new Date() } });
  }
  return { item, before };
}

async function addNote(adminId, caseId, body) {
  const item = await ModerationCase.exists({ _id: caseId });
  if (!item) throw new AppError(404, 'MODERATION_CASE_NOT_FOUND', 'Moderation case not found');
  return OperationalNote.create({ subjectType: 'moderation_case', subjectId: caseId, authorAdminId: adminId, body });
}

module.exports = { caseNumber, severityForReason, createOrAttachCase, listAdminCases, getAdminCase, assignCase, decideCase, addNote, ACTIVE_STATUSES };
