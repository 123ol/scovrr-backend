const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./admin.service');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');
const userStatusService = require('../users/user-status.service');
const trustSafetyService = require('./trust-safety.service');
const operationsService = require('./operations.service');
const authService = require('../auth/auth.service');

function requestAuditMetadata(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null };
}

const me = asyncHandler(async (req, res) => sendSuccess(res, { admin: service.serializeAdmin(req.auth.user) }));
const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listAdmins(req.query)));
const listUsers = asyncHandler(async (req, res) => sendSuccess(res, await service.listUsers(req.query)));
const roles = asyncHandler(async (_req, res) => sendSuccess(res, { roles: service.roleDefinitions() }));
const invite = asyncHandler(async (req, res) => {
  const result = await service.createInvitation(req.auth.user, req.body);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.ADMIN_INVITED, targetType: 'admin_invitation', targetId: result.invitation._id, reason: 'Administrator invitation created', metadata: { email: req.body.email, roles: result.invitation.roles }, ...requestAuditMetadata(req) });
  return res.status(201).json({ success: true, data: { invitation: result.invitation.toSafeJSON(), inviteToken: result.token, delivery: 'manual_handoff_required' } });
});
const acceptInvitation = asyncHandler(async (req, res) => {
  const user = await service.acceptInvitation(req.params.token, req.body);
  await recordAudit({ actorId: user._id, actorType: 'system', action: AUDIT_ACTIONS.ADMIN_CREATED, targetType: 'user', targetId: user._id, metadata: { invitationAccepted: true, ...requestAuditMetadata(req) } });
  return sendSuccess(res, { admin: service.serializeAdmin(user) });
});
const updateRoles = asyncHandler(async (req, res) => {
  const result = await service.updateRoles(req.auth.user, req.params.adminId, req.body);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.ADMIN_ROLE_CHANGED, targetType: 'user', targetId: result.target._id, reason: req.body.reason, before: result.before, after: result.after, ...requestAuditMetadata(req) });
  return sendSuccess(res, { admin: result.after });
});
const suspend = asyncHandler(async (req, res) => {
  const result = await service.changeStatus(req.auth.user, req.params.adminId, 'suspended');
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.ADMIN_SUSPENDED, targetType: 'user', targetId: result.target._id, reason: req.body.reason, before: result.before, after: result.after, ...requestAuditMetadata(req) });
  return sendSuccess(res, { admin: result.after });
});
const reactivate = asyncHandler(async (req, res) => {
  const result = await service.changeStatus(req.auth.user, req.params.adminId, 'active');
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.ADMIN_REACTIVATED, targetType: 'user', targetId: result.target._id, reason: req.body.reason, before: result.before, after: result.after, ...requestAuditMetadata(req) });
  return sendSuccess(res, { admin: result.after });
});

const suspendUser = asyncHandler(async (req, res) => {
  const result = await userStatusService.changeUserStatus(req.auth.userId, req.params.userId, 'suspended');
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.USER_SUSPENDED, targetType: 'user', targetId: result.target._id, reason: req.body.reason, before: { status: result.before }, after: { status: result.after }, ...requestAuditMetadata(req) });
  return sendSuccess(res, { user: result.target.toSafeJSON(), changed: result.changed });
});

const reactivateUser = asyncHandler(async (req, res) => {
  const result = await userStatusService.changeUserStatus(req.auth.userId, req.params.userId, 'active');
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.USER_REACTIVATED, targetType: 'user', targetId: result.target._id, reason: req.body.reason, before: { status: result.before }, after: { status: result.after }, ...requestAuditMetadata(req) });
  return sendSuccess(res, { user: result.target.toSafeJSON(), changed: result.changed });
});
const accountLifecyclePolicy = asyncHandler(async (_req, res) => sendSuccess(res, { policy: authService.getAccountLifecyclePolicy() }));
const listAccountDeletionRequests = asyncHandler(async (req, res) => sendSuccess(res, await authService.listAccountDeletionRequests(req.query)));
const getAccountDeletionRequest = asyncHandler(async (req, res) => {
  const { AccountDeletionRequest } = require('../auth/account-deletion-request.model');
  const request = await AccountDeletionRequest.findById(req.params.requestId).populate('userId', 'firstName lastName email accountType status');
  if (!request) return res.status(404).json({ success: false, error: { code: 'DELETION_REQUEST_NOT_FOUND', message: 'Account deletion request not found' } });
  return sendSuccess(res, { deletionRequest: { ...request.toSafeJSON(), user: request.userId?.email ? { id: request.userId._id.toString(), firstName: request.userId.firstName, lastName: request.userId.lastName, email: request.userId.email, accountType: request.userId.accountType, status: request.userId.status } : null } });
});
const reviewAccountDeletionRequest = asyncHandler(async (req, res) => {
  const request = await authService.reviewAccountDeletionRequest(req.auth.userId, req.params.requestId, req.body.action, req.body.reason);
  await recordAudit({ actorId: req.auth.userId, action: req.body.action === 'start_review' ? AUDIT_ACTIONS.ACCOUNT_DELETION_REVIEW_STARTED : AUDIT_ACTIONS.ACCOUNT_DELETION_REJECTED, targetType: 'account_deletion_request', targetId: request._id, reason: req.body.reason, after: { status: request.status }, ...requestAuditMetadata(req) });
  return sendSuccess(res, { deletionRequest: request.toSafeJSON() });
});
const trustSafetyOverview = asyncHandler(async (_req, res) => sendSuccess(res, { trustSafety: await trustSafetyService.getTrustSafetyOverview() }));
const operationsHealth = asyncHandler(async (_req, res) => sendSuccess(res, { operations: await operationsService.getOperationsHealth() }));
const deadJobs = asyncHandler(async (req, res) => sendSuccess(res, { jobs: await operationsService.listDeadJobs(req.query) }));
const replayJob = asyncHandler(async (req, res) => {
  const job = await operationsService.replayDeadJob(req.params.jobId);
  await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.JOB_REPLAYED, targetType: 'job', targetId: req.params.jobId, reason: req.body.reason, metadata: { jobType: job.type, attemptsReset: true }, ...requestAuditMetadata(req) });
  return sendSuccess(res, { job });
});

module.exports = { me, list, listUsers, roles, invite, acceptInvitation, updateRoles, suspend, reactivate, suspendUser, reactivateUser, accountLifecyclePolicy, listAccountDeletionRequests, getAccountDeletionRequest, reviewAccountDeletionRequest, trustSafetyOverview, operationsHealth, deadJobs, replayJob };
