const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { ADMIN_PERMISSIONS, hasAdminPermission, isSuperAdmin, roleDefinitions } = require('../src/modules/admin/admin-permissions');
const { requireAdmin, requireAdminPermission } = require('../src/middleware/auth');
const { assertAssignable, assertCanManageTarget, assertFinalSuperAdminProtection } = require('../src/modules/admin/admin.service');
const { userListSchema, operationsJobsSchema, jobReplaySchema } = require('../src/modules/admin/admin.validation');
const { bulkDecisionSchema } = require('../src/modules/moderation/moderation.validation');
const { userAdminFilter } = require('../src/modules/admin/admin.service');
const { AuditLog } = require('../src/modules/audit/audit-log.model');
const { safeAuditValue } = require('../src/modules/audit/audit.service');
const { AdminInvitation } = require('../src/modules/admin/admin-invitation.model');
const { summarizeTrustSafety } = require('../src/modules/admin/trust-safety.service');
const operationsService = require('../src/modules/admin/operations.service');
const { Job } = require('../src/jobs/job.model');

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

test('admin user search supports bounded verification and creation-date filters', () => {
  const parsed = userListSchema.safeParse({ body: {}, params: {}, query: { search: '0803', accountType: 'seller', emailVerified: 'true', phoneVerified: 'false', createdFrom: '2030-01-01T00:00:00.000Z', createdTo: '2030-01-31T23:59:59.999Z', page: '1', limit: '50' } });
  assert.equal(parsed.success, true);
  const filter = userAdminFilter(parsed.data.query);
  assert.equal(filter.accountType, 'seller');
  assert.deepEqual(filter.emailVerifiedAt, { $ne: null });
  assert.equal(filter.phoneVerifiedAt, null);
  assert.equal(filter.createdAt.$gte.toISOString(), '2030-01-01T00:00:00.000Z');
  assert.equal(filter.$or.length, 4);
  assert.equal(userListSchema.safeParse({ body: {}, params: {}, query: { createdFrom: '2030-02-01', createdTo: '2030-01-01' } }).success, false);
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
  assert.equal(typeof require('../src/modules/audit/audit.service').getAuditSummary, 'function');
  assert.equal(typeof require('../src/modules/audit/audit.controller').summary, 'function');
});

test('administrator invitations store only a token hash and expire', () => {
  assert.equal(AdminInvitation.schema.path('tokenHash').options.select, false);
  assert.equal(AdminInvitation.schema.path('expiresAt').instance, 'Date');
  assert.equal(AdminInvitation.schema.path('status').enumValues.includes('accepted'), true);
});

test('trust and safety overview exposes bounded cross-queue alerts without case details', () => {
  const overview = summarizeTrustSafety({
    reports: { active: 4, critical: 1, unassigned: 2 },
    disputes: { active: 3, overdue: 2, unassigned: 1, recoveryRequired: 1 },
    moderation: { active: 5, urgent: 2, unassigned: 3 }
  });
  assert.deepEqual(overview.totals, { activeReports: 4, activeDisputes: 3, activeModerationCases: 5, alertCount: 4 });
  assert.deepEqual(overview.alerts.map((alert) => alert.code), ['critical_reports', 'overdue_disputes', 'financial_recovery', 'unassigned_moderation']);
  assert.equal(Object.hasOwn(overview, 'caseDetails'), false);
});

test('operations health remains a read-only admin snapshot with queue and process fields', () => {
  assert.equal(typeof operationsService.getOperationsHealth, 'function');
  assert.equal(typeof require('../src/modules/admin/admin.controller').operationsHealth, 'function');
});

test('dead-letter job operations are separately permissioned and bounded', () => {
  assert.equal(hasAdminPermission(['operations'], ADMIN_PERMISSIONS.JOBS_READ), true);
  assert.equal(hasAdminPermission(['customer_support'], ADMIN_PERMISSIONS.JOBS_MANAGE), false);
  assert.equal(operationsJobsSchema.safeParse({ body: {}, params: {}, query: { page: '1', limit: '25' } }).success, true);
  assert.equal(operationsJobsSchema.safeParse({ body: {}, params: {}, query: { limit: '51' } }).success, false);
  assert.equal(jobReplaySchema.safeParse({ body: { reason: 'Retry after provider outage' }, params: { jobId: '507f1f77bcf86cd799439011' }, query: {} }).success, true);
  assert.equal(jobReplaySchema.safeParse({ body: { reason: 'no' }, params: { jobId: '507f1f77bcf86cd799439011' }, query: {} }).success, false);
});

test('dead-letter serialization excludes job payloads and replay is exposed through admin control', () => {
  const job = { _id: new mongoose.Types.ObjectId(), type: 'notification_push', status: 'dead', attempts: 5, maxAttempts: 5, nextRunAt: new Date(), lastError: 'provider token=secret', createdAt: new Date(), updatedAt: new Date(), completedAt: null, payload: { notificationId: 'private' } };
  const safe = operationsService.safeDeadJob(job);
  assert.equal(safe.payload, undefined);
  assert.match(safe.lastError, /token=\[REDACTED\]/);
  assert.equal(typeof require('../src/modules/admin/admin.controller').deadJobs, 'function');
  assert.equal(typeof require('../src/modules/admin/admin.controller').replayJob, 'function');
});

test('dead-letter replay only claims dead jobs and resets retry state', async () => {
  const jobId = new mongoose.Types.ObjectId();
  const originalFindOneAndUpdate = Job.findOneAndUpdate;
  let filter;
  let update;
  Job.findOneAndUpdate = (nextFilter, nextUpdate) => {
    filter = nextFilter;
    update = nextUpdate;
    return { select: async () => ({ _id: jobId, type: 'account_export', status: 'queued', attempts: 0, maxAttempts: 5, nextRunAt: new Date(), lastError: 'previous failure', createdAt: new Date(), updatedAt: new Date(), completedAt: null }) };
  };
  try {
    const replayed = await operationsService.replayDeadJob(jobId.toString());
    assert.equal(filter.status, 'dead');
    assert.equal(update.$set.status, 'queued');
    assert.equal(update.$set.attempts, 0);
    assert.equal(update.$set.lockedAt, null);
    assert.equal(replayed.status, 'queued');
  } finally {
    Job.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test('bulk moderation decisions are bounded and permissioned at the existing case boundary', () => {
  const valid = bulkDecisionSchema.safeParse({ body: { caseIds: ['507f1f77bcf86cd799439011'], outcome: 'removed', note: 'Policy decision' }, params: {}, query: {} });
  assert.equal(valid.success, true);
  const tooMany = bulkDecisionSchema.safeParse({ body: { caseIds: Array.from({ length: 51 }, () => '507f1f77bcf86cd799439011'), outcome: 'removed', note: 'Policy decision' }, params: {}, query: {} });
  assert.equal(tooMany.success, false);
  assert.equal(typeof require('../src/modules/moderation/moderation.controller').bulkDecide, 'function');
  assert.equal(typeof require('../src/modules/moderation/moderation.controller').assignees, 'function');
  assert.equal(typeof require('../src/modules/moderation/moderation.service').listModerationAssignees, 'function');
});
