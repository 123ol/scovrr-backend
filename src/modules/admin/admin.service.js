const bcrypt = require('bcryptjs');
const { AppError } = require('../../common/errors/AppError');
const { createOpaqueToken, hashToken } = require('../../common/security/tokens');
const { User } = require('../users/user.model');
const { RefreshSession } = require('../auth/refresh-session.model');
const { AdminInvitation } = require('./admin-invitation.model');
const { ADMIN_ROLE_NAMES, SYSTEM_ADMIN_ROLE_NAMES, canonicalRole, isSuperAdmin, permissionsForAdminRoles, roleDefinitions } = require('./admin-permissions');

const BCRYPT_ROUNDS = 12;
const INVITATION_TTL_MS = 48 * 60 * 60 * 1_000;

function normalizeRoles(roles = []) {
  return [...new Set(roles.map((role) => canonicalRole(role)))];
}

function assertKnownRoles(roles) {
  if (!roles.length || roles.some((role) => !SYSTEM_ADMIN_ROLE_NAMES.includes(role))) throw new AppError(400, 'INVALID_ADMIN_ROLE', 'One or more administrator roles are invalid');
}

function serializeAdmin(user) {
  return { ...user.toSafeJSON({ includeAdmin: true }), roles: user.adminRoles, permissions: permissionsForAdminRoles(user.adminRoles) };
}

function assertAssignable(actor, roles) {
  assertKnownRoles(roles);
  if (roles.includes('super_admin') && !isSuperAdmin(actor.adminRoles)) throw new AppError(403, 'SUPER_ADMIN_REQUIRED', 'Only a Super Admin can grant the Super Admin role');
}

async function countActiveSuperAdmins() {
  return User.countDocuments({ status: 'active', adminRoles: 'super_admin' });
}

async function getAdminTarget(adminId) {
  const target = await User.findOne({ _id: adminId, adminRoles: { $in: ADMIN_ROLE_NAMES } });
  if (!target) throw new AppError(404, 'ADMIN_NOT_FOUND', 'Administrator not found');
  return target;
}

function assertCanManageTarget(actor, target) {
  const actorSuper = isSuperAdmin(actor.adminRoles);
  const targetSuper = isSuperAdmin(target.adminRoles);
  if (targetSuper && !actorSuper) throw new AppError(403, 'SUPER_ADMIN_PROTECTED', 'Only a Super Admin can modify another Super Admin');
  if (actor._id.toString() === target._id.toString()) throw new AppError(409, 'SELF_ADMIN_CHANGE_NOT_ALLOWED', 'Administrators cannot change their own administrative access');
}

function assertFinalSuperAdminProtection({ targetRoles = [], nextRoles = targetRoles, nextStatus = 'active', activeSuperAdminCount = 2 }) {
  const targetSuper = isSuperAdmin(targetRoles);
  const nextSuper = isSuperAdmin(nextRoles);
  if (targetSuper && !nextSuper && activeSuperAdminCount <= 1) throw new AppError(409, 'FINAL_SUPER_ADMIN_PROTECTED', 'The final active Super Admin cannot be demoted');
  if (targetSuper && nextStatus === 'suspended' && activeSuperAdminCount <= 1) throw new AppError(409, 'FINAL_SUPER_ADMIN_PROTECTED', 'The final active Super Admin cannot be suspended');
}

async function listAdmins({ search, status, page, limit }) {
  const filter = { adminRoles: { $in: ADMIN_ROLE_NAMES }, ...(status ? { status } : {}) };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ firstName: new RegExp(escaped, 'i') }, { lastName: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }];
  }
  const skip = (page - 1) * limit;
  const [admins, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  return { admins: admins.map(serializeAdmin), total, page, limit, pages: Math.ceil(total / limit) };
}

function userAdminFilter({ search, status, accountType, emailVerified, phoneVerified, createdFrom, createdTo } = {}) {
  const filter = { ...(status ? { status } : {}), ...(accountType ? { accountType } : {}) };
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ firstName: new RegExp(escaped, 'i') }, { lastName: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }];
  }
  if (emailVerified === 'true') filter.emailVerifiedAt = { $ne: null };
  if (emailVerified === 'false') filter.emailVerifiedAt = null;
  if (phoneVerified === 'true') filter.phoneVerifiedAt = { $ne: null };
  if (phoneVerified === 'false') filter.phoneVerifiedAt = null;
  if (createdFrom || createdTo) filter.createdAt = { ...(createdFrom ? { $gte: createdFrom } : {}), ...(createdTo ? { $lte: createdTo } : {}) };
  return filter;
}

async function listUsers({ search, status, accountType, emailVerified, phoneVerified, createdFrom, createdTo, page, limit }) {
  const filter = userAdminFilter({ search, status, accountType, emailVerified, phoneVerified, createdFrom, createdTo });
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), User.countDocuments(filter)]);
  return { users: users.map((user) => user.toSafeJSON({ includeAdmin: true })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function createInvitation(actor, input) {
  const roles = normalizeRoles(input.roles);
  assertAssignable(actor, roles);
  const email = input.email.trim().toLowerCase();
  await AdminInvitation.updateMany({ email, status: 'pending' }, { $set: { status: 'revoked' } });
  const token = createOpaqueToken();
  const invitation = await AdminInvitation.create({ email, firstName: input.firstName, lastName: input.lastName, roles, tokenHash: hashToken(token), invitedBy: actor._id, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) });
  return { invitation, token };
}

async function acceptInvitation(token, input) {
  const invitedEmail = await AdminInvitation.findOne({ tokenHash: hashToken(token), status: 'pending', expiresAt: { $gt: new Date() } }).select('email');
  if (!invitedEmail) throw new AppError(400, 'ADMIN_INVITATION_INVALID', 'This administrator invitation is invalid or expired');
  const existingUser = await User.findOne({ email: invitedEmail.email }).select('_id status');
  if (!existingUser && !input.password) throw new AppError(400, 'ADMIN_PASSWORD_REQUIRED', 'A password is required to create the administrator account');
  const invitation = await AdminInvitation.findOneAndUpdate({ tokenHash: hashToken(token), status: 'pending', expiresAt: { $gt: new Date() } }, { $set: { status: 'accepted', acceptedAt: new Date() } }, { new: true }).select('+tokenHash');
  if (!invitation) throw new AppError(400, 'ADMIN_INVITATION_INVALID', 'This administrator invitation is invalid or expired');
  let user = await User.findOne({ email: invitation.email }).select('+passwordHash');
  if (user) {
    if (user.status === 'suspended' || user.status === 'deactivated') throw new AppError(403, 'ADMIN_ACCOUNT_UNAVAILABLE', 'The invited account is not available');
    user.adminRoles = normalizeRoles([...user.adminRoles, ...invitation.roles]);
    user.status = 'active';
    await user.save();
  } else {
    if (!input.password) throw new AppError(400, 'ADMIN_PASSWORD_REQUIRED', 'A password is required to create the administrator account');
    user = await User.create({ firstName: invitation.firstName, lastName: invitation.lastName, email: invitation.email, passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS), adminRoles: invitation.roles, status: 'active' });
  }
  return user;
}

async function updateRoles(actor, adminId, input) {
  const target = await getAdminTarget(adminId);
  assertCanManageTarget(actor, target);
  const roles = normalizeRoles(input.roles);
  assertAssignable(actor, roles);
  assertFinalSuperAdminProtection({ targetRoles: target.adminRoles, nextRoles: roles, activeSuperAdminCount: await countActiveSuperAdmins() });
  const before = serializeAdmin(target);
  target.adminRoles = roles;
  await target.save();
  await RefreshSession.updateMany({ user: target._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { target, before, after: serializeAdmin(target) };
}

async function changeStatus(actor, adminId, status) {
  const target = await getAdminTarget(adminId);
  assertCanManageTarget(actor, target);
  assertFinalSuperAdminProtection({ targetRoles: target.adminRoles, nextStatus: status, activeSuperAdminCount: await countActiveSuperAdmins() });
  const before = serializeAdmin(target);
  target.status = status;
  await target.save();
  if (status === 'suspended') await RefreshSession.updateMany({ user: target._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { target, before, after: serializeAdmin(target) };
}

module.exports = { listAdmins, listUsers, userAdminFilter, createInvitation, acceptInvitation, updateRoles, changeStatus, serializeAdmin, normalizeRoles, assertAssignable, assertCanManageTarget, assertFinalSuperAdminProtection, countActiveSuperAdmins, roleDefinitions };
