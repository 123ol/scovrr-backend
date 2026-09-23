const { connectDatabase, disconnectDatabase } = require('../src/config/database');

const INDEX_DEFINITIONS = [
  { collection: 'analyticsevents', name: 'analytics_event_event_id_unique', key: { eventId: 1 }, options: { unique: true, sparse: true } },
  { collection: 'analyticsevents', name: 'analytics_event_business_time', key: { businessId: 1, occurredAt: -1, eventName: 1 }, options: {} },
  { collection: 'analyticsevents', name: 'analytics_event_retention_time', key: { retentionClass: 1, occurredAt: 1 }, options: {} },
  { collection: 'analyticssessions', name: 'analytics_session_expiry', key: { lastActivityAt: 1 }, options: { expireAfterSeconds: 60 * 60 * 24 * 180 } },
  { collection: 'analyticsoutboxes', name: 'analytics_outbox_due', key: { status: 1, nextAttemptAt: 1, createdAt: 1 }, options: {} },
  { collection: 'analyticsdailyaggregates', name: 'analytics_daily_business_date', key: { businessId: 1, dateKey: -1, entityType: 1 }, options: {} },
  { collection: 'analyticsmetricdedupes', name: 'analytics_metric_dedupe_expiry', key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } }
];

function sameKey(left = {}, right = {}) { const a = Object.entries(left); const b = Object.entries(right); return a.length === b.length && a.every(([field, direction], index) => b[index]?.[0] === field && b[index]?.[1] === direction); }
async function runIndexMigration({ dryRun = true, db, logger = console } = {}) {
  if (!db) throw new Error('A MongoDB database handle is required');
  const report = { dryRun, created: [], existing: [], conflicts: [] };
  for (const definition of INDEX_DEFINITIONS) {
    const collection = db.collection(definition.collection); const indexes = await collection.listIndexes().toArray(); const current = indexes.find((item) => sameKey(item.key, definition.key));
    if (current) { if (Boolean(definition.options.unique) && !current.unique) report.conflicts.push({ collection: definition.collection, name: definition.name, existing: current.name, reason: 'INDEX_UNIQUENESS_MISMATCH' }); else report.existing.push({ collection: definition.collection, name: current.name }); continue; }
    if (!dryRun) await collection.createIndex(definition.key, { ...definition.options, name: definition.name });
    report.created.push({ collection: definition.collection, name: definition.name });
  }
  logger.info(`${dryRun ? 'Would apply' : 'Applied'} analytics indexes`);
  return report;
}
async function main() { const dryRun = !process.argv.includes('--apply'); await connectDatabase(); try { const report = await runIndexMigration({ dryRun, db: require('mongoose').connection.db }); console.log(JSON.stringify(report, null, 2)); if (report.conflicts.length) process.exitCode = 2; } finally { await disconnectDatabase(); } }
if (require.main === module) main().catch((error) => { console.error(`Analytics index migration failed: ${error.message}`); process.exitCode = 1; });
module.exports = { INDEX_DEFINITIONS, sameKey, runIndexMigration };
