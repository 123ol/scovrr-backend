const { AuditLog } = require('./audit-log.model');

const SENSITIVE_KEY = /(password|passwordhash|token|secret|authorization|cookie|accesscode|privatekey|bank|accountnumber|recipientcode|verificationdocument|documentcontents)/i;

function safeAuditValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeAuditValue(item, key, depth + 1));
  if (typeof value?.toString === 'function' && value._bsontype === 'ObjectId') return value.toString();
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200).map(([childKey, childValue]) => [childKey, safeAuditValue(childValue, childKey, depth + 1)]));
  return String(value);
}

async function recordAudit(input) {
  return AuditLog.create({
    actorId: input.actorId || null,
    actorType: input.actorType || (input.actorId ? 'admin' : 'system'),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId || null,
    businessId: input.businessId || null,
    correlationId: input.correlationId || null,
    reason: input.reason || null,
    before: safeAuditValue(input.before, 'before'),
    after: safeAuditValue(input.after, 'after'),
    metadata: safeAuditValue(input.metadata, 'metadata') || {},
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null
  });
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listAuditLogs(query) {
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.targetType) filter.targetType = query.targetType;
  if (query.targetId) filter.targetId = query.targetId;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
  if (query.search) {
    const search = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ action: search }, { targetType: search }, { reason: search }, { correlationId: search }];
  }
  const skip = (query.page - 1) * query.limit;
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).populate('actorId', 'firstName lastName email'),
    AuditLog.countDocuments(filter)
  ]);
  return { logs: logs.map((log) => ({ ...log.toSafeJSON(), actor: log.actorId?.email ? { id: log.actorId._id.toString(), firstName: log.actorId.firstName, lastName: log.actorId.lastName, email: log.actorId.email } : null })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

module.exports = { recordAudit, listAuditLogs, safeAuditValue };
