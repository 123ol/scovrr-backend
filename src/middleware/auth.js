const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { AppError } = require('../common/errors/AppError');
const { User } = require('../modules/users/user.model');
const { hasAdminPermission, permissionsForAdminRoles, isSuperAdmin } = require('../modules/admin/admin-rbac');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function requireAuth(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid access token is required');
    }

    const payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'] });
    if (payload.typ !== 'access' || !payload.sub || !payload.sid) {
      throw new AppError(401, 'INVALID_ACCESS_TOKEN', 'The access token is invalid');
    }

    const user = await User.findById(payload.sub);
    if (!user || !['active', 'suspended'].includes(user.status)) {
      throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
    }
    if (user.status === 'suspended' && MUTATING_METHODS.has(req.method) && !/\/auth\/logout(?:\?|$)/.test(req.originalUrl || '')) {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account cannot perform this action while it is suspended');
    }

    req.auth = {
      user,
      userId: user._id.toString(),
      sessionId: payload.sid,
      accountStatus: user.status
    };
    return next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    return next(new AppError(401, 'INVALID_ACCESS_TOKEN', 'The access token is invalid or expired'));
  }
}

function optionalAuth(req, res, next) {
  if (!req.get('authorization')) return next();
  return requireAuth(req, res, next);
}

function requireAdmin(req, _res, next) {
  if (!req.auth) return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid access token is required'));
  if (req.auth.accountStatus && req.auth.accountStatus !== 'active') return next(new AppError(403, 'ADMIN_ACCOUNT_UNAVAILABLE', 'This administrator account is not available'));
  const roles = req.auth.user.adminRoles || [];
  if (!hasAdminPermission(roles, 'admin.access') && !hasAdminPermission(roles, 'admin_access')) {
    return next(new AppError(403, 'ADMIN_ACCESS_REQUIRED', 'Administrator access is required'));
  }
  req.admin = { roles, permissions: permissionsForAdminRoles(roles), isSuperAdmin: isSuperAdmin(roles) };
  return next();
}

function requireAdminPermission(permission) {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid access token is required'));
    if (req.auth.accountStatus && req.auth.accountStatus !== 'active') return next(new AppError(403, 'ADMIN_ACCOUNT_UNAVAILABLE', 'This administrator account is not available'));
    const roles = req.auth.user.adminRoles || [];
    const requiredPermissions = Array.isArray(permission) ? permission : [permission];
    const allowed = requiredPermissions.some((required) => hasAdminPermission(roles, required));
    if (!allowed || !hasAdminPermission(roles, 'admin.access') && !hasAdminPermission(roles, 'admin_access')) {
      return next(new AppError(403, 'ADMIN_PERMISSION_REQUIRED', 'You do not have permission to perform this action'));
    }
    req.admin = { roles, permissions: permissionsForAdminRoles(roles), isSuperAdmin: isSuperAdmin(roles) };
    return next();
  };
}

function requireAnyAdminPermission(permissions) {
  return requireAdminPermission(permissions);
}

function requireAllAdminPermissions(permissions = []) {
  return (req, _res, next) => {
    if (!req.auth) return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid access token is required'));
    if (req.auth.accountStatus && req.auth.accountStatus !== 'active') return next(new AppError(403, 'ADMIN_ACCOUNT_UNAVAILABLE', 'This administrator account is not available'));
    const roles = req.auth.user.adminRoles || [];
    const allowed = hasAdminPermission(roles, 'admin.access') && permissions.every((permission) => hasAdminPermission(roles, permission));
    if (!allowed) return next(new AppError(403, 'ADMIN_PERMISSION_REQUIRED', 'You do not have permission to perform this action'));
    req.admin = { roles, permissions: permissionsForAdminRoles(roles), isSuperAdmin: isSuperAdmin(roles) };
    return next();
  };
}

module.exports = { requireAuth, optionalAuth, requireAdmin, requireAdminPermission, requireAnyAdminPermission, requireAllAdminPermissions, permissionsForAdminRoles };
