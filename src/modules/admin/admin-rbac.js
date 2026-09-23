const { ROLE_PERMISSIONS, ADMIN_ROLE_NAMES, permissionsForAdminRoles, hasAdminPermission, isSuperAdmin, roleDefinitions } = require('./admin-permissions');

// Compatibility export for modules/tests that used the original registry name.
const ADMIN_ROLE_PERMISSIONS = ROLE_PERMISSIONS;

module.exports = { ADMIN_ROLE_PERMISSIONS, ADMIN_ROLE_NAMES, permissionsForAdminRoles, hasAdminPermission, isSuperAdmin, roleDefinitions };
