const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./reconciliation.service');
const { recordAudit } = require('../audit/audit.service');
const { AUDIT_ACTIONS } = require('../audit/audit-events');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listReconciliations(req.query)));
const run = asyncHandler(async (req, res) => { const result = await service.runReconciliation(req.body); await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.RECONCILIATION_RUN, targetType: 'payment_reconciliation_run', reason: 'Manual reconciliation run', metadata: { provider: req.body.provider, limit: req.body.limit, runId: result.runId }, ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, result); });
const reconcilePayment = asyncHandler(async (req, res) => sendSuccess(res, { reconciliation: await service.reconcileOnePayment(req.params.paymentId) }));
const resolve = asyncHandler(async (req, res) => { const record = await service.resolveReconciliation(req.params.reconciliationId, req.auth.userId, req.body); await recordAudit({ actorId: req.auth.userId, action: AUDIT_ACTIONS.RECONCILIATION_RESOLVED, targetType: 'payment_reconciliation', targetId: record._id, reason: req.body.resolution, after: record.toSafeJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { reconciliation: record.toSafeJSON() }); });

module.exports = { list, run, reconcilePayment, resolve };
