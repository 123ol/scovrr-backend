const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./admin.service');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');
const userStatusService = require('../users/user-status.service');

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

module.exports = { me, list, listUsers, roles, invite, acceptInvitation, updateRoles, suspend, reactivate, suspendUser, reactivateUser };
