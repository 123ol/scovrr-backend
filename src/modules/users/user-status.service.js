const { AppError } = require('../../common/errors/AppError');
const { RefreshSession } = require('../auth/refresh-session.model');
const { User } = require('./user.model');

function assertUserCanAct(user) {
  const status = user?.status || user;
  if (status !== 'active') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account cannot perform this action while it is suspended');
  }
}

async function assertUserCanActById(userId) {
  const user = await User.findById(userId).select('status accountType');
  if (!user) throw new AppError(401, 'ACCOUNT_NOT_FOUND', 'The account could not be found');
  assertUserCanAct(user);
  return user;
}

async function changeUserStatus(actorId, targetId, targetStatus) {
  if (actorId.toString() === targetId.toString()) {
    throw new AppError(400, 'CANNOT_CHANGE_OWN_STATUS', 'Administrators cannot change their own account status');
  }
  const current = await User.findById(targetId).select('+passwordHash');
  if (!current) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  if (current.adminRoles?.length) throw new AppError(403, 'ADMIN_STATUS_ROUTE_REQUIRED', 'Administrator accounts use administrator status controls');
  if (!['active', 'suspended'].includes(targetStatus)) throw new AppError(400, 'INVALID_USER_STATUS', 'Only active and suspended user states are supported here');
  if (!['active', 'suspended'].includes(current.status)) throw new AppError(409, 'USER_STATUS_NOT_CHANGEABLE', 'This account requires the account-recovery workflow');
  if (current.status === targetStatus) return { target: current, before: current.status, after: current.status, changed: false };
  const updated = await User.findOneAndUpdate(
    { _id: targetId, status: current.status, adminRoles: { $size: 0 } },
    { $set: { status: targetStatus } },
    { new: true }
  );
  if (!updated) throw new AppError(409, 'USER_STATUS_CHANGED', 'The user status changed; reload and try again');
  if (targetStatus === 'suspended') await RefreshSession.updateMany({ user: targetId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return { target: updated, before: current.status, after: updated.status, changed: true };
}

module.exports = { assertUserCanAct, assertUserCanActById, changeUserStatus };
