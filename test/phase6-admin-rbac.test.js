const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { ADMIN_PERMISSIONS, hasAdminPermission, isSuperAdmin, roleDefinitions } = require('../src/modules/admin/admin-permissions');
const { requireAdmin, requireAdminPermission } = require('../src/middleware/auth');
const { assertAssignable, assertCanManageTarget, assertFinalSuperAdminProtection } = require('../src/modules/admin/admin.service');
const { AuditLog } = require('../src/modules/audit/audit-log.model');
const { safeAuditValue } = require('../src/modules/audit/audit.service');
const { AdminInvitation } = require('../src/modules/admin/admin-invitation.model');

function execute(middleware, req) {
  return new Promise((resolve) => middleware(req, {}, (error) => resolve(error || null)));
}

function authRequest(roles, extraUser = {}) {
  return { auth: { user: { adminRoles: roles, ...extraUser } } };
}

test('central registry resolves canonical and legacy roles to exact permissions', () => {
  assert.equal(hasAdminPermission(['finance_admin'], ADMIN_PERMISSIONS.PAYOUTS_READ), true);
  assert.equal(hasAdminPermission(['customer_support'], ADMIN_PERMISSIONS.PAYOUTS_EXECUTE), false);
  assert.equal(hasAdminPermission(['moderation'], 'reports.manage'), true);
  assert.equal(isSuperAdmin(['super_admin']), true);
  assert.ok(roleDefinitions().some((role) => role.name === 'finance_admin'));
});

test('admin middleware is backend-authoritative and ignores frontend-supplied permissions', async () => {
  assert.equal((await execute(requireAdmin, authRequest([]))).code, 'ADMIN_ACCESS_REQUIRED');
  assert.equal((await execute(requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_EXECUTE), authRequest(['customer_support'], { permissions: ['*'], role: 'super_admin' }))).code, 'ADMIN_PERMISSION_REQUIRED');
  assert.equal((await execute(requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_READ), authRequest(['finance_admin']))), null);
  assert.equal((await execute(requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_EXECUTE), authRequest(['moderator']))).code, 'ADMIN_PERMISSION_REQUIRED');
  assert.equal((await execute(requireAdminPermission(ADMIN_PERMISSIONS.PAYOUTS_READ), {})).code, 'AUTHENTICATION_REQUIRED');
});

test('finance read and action permissions remain separate', () => {
  assert.equal(hasAdminPermission(['analytics_admin'], ADMIN_PERMISSIONS.PAYMENTS_READ), false);
  assert.equal(hasAdminPermission(['finance_admin'], ADMIN_PERMISSIONS.REFUNDS_READ), true);
  assert.equal(hasAdminPermission(['finance_admin'], ADMIN_PERMISSIONS.REFUNDS_EXECUTE), true);
  assert.equal(hasAdminPermission(['customer_support'], ADMIN_PERMISSIONS.REFUNDS_EXECUTE), false);
});

test('Super Admin protections prevent privilege escalation and removal of the final Super Admin', () => {
  const actor = { _id: new mongoose.Types.ObjectId(), adminRoles: ['finance_admin'] };
  const target = { _id: new mongoose.Types.ObjectId(), adminRoles: ['super_admin'] };
  assert.throws(() => assertCanManageTarget(actor, target), (error) => error.code === 'SUPER_ADMIN_PROTECTED');
  assert.throws(() => assertAssignable(actor, ['super_admin']), (error) => error.code === 'SUPER_ADMIN_REQUIRED');
  assert.throws(() => assertFinalSuperAdminProtection({ targetRoles: ['super_admin'], nextRoles: ['operations'], activeSuperAdminCount: 1 }), (error) => error.code === 'FINAL_SUPER_ADMIN_PROTECTED');
  assert.throws(() => assertFinalSuperAdminProtection({ targetRoles: ['super_admin'], nextRoles: ['super_admin'], nextStatus: 'suspended', activeSuperAdminCount: 1 }), (error) => error.code === 'FINAL_SUPER_ADMIN_PROTECTED');
  assert.doesNotThrow(() => assertFinalSuperAdminProtection({ targetRoles: ['super_admin'], nextRoles: ['operations'], activeSuperAdminCount: 2 }));
});

test('audit records support system actors, request context, and safe redaction', () => {
  assert.equal(AuditLog.schema.path('actorId').options.required, undefined);
  assert.equal(AuditLog.schema.path('actorType').enumValues.includes('system'), true);
  assert.equal(safeAuditValue({ password: 'do-not-store', accessToken: 'do-not-store', nested: { recipientCode: 'secret' }, reason: 'safe' }).password, '[REDACTED]');
  assert.equal(safeAuditValue({ nested: { recipientCode: 'secret' } }).nested.recipientCode, '[REDACTED]');
  assert.equal(safeAuditValue({ reason: 'safe' }).reason, 'safe');
  assert.equal(AuditLog.schema.path('correlationId').instance, 'String');
});

test('administrator invitations store only a token hash and expire', () => {
  assert.equal(AdminInvitation.schema.path('tokenHash').options.select, false);
  assert.equal(AdminInvitation.schema.path('expiresAt').instance, 'Date');
  assert.equal(AdminInvitation.schema.path('status').enumValues.includes('accepted'), true);
});
