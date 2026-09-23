const { env } = require('../src/config/env');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { Business } = require('../src/modules/businesses/business.model');
const { BusinessSubscription } = require('../src/modules/subscriptions/subscription.model');
const subscriptionService = require('../src/modules/subscriptions/subscription.service');

function parseArgs(argv) {
  const options = { dryRun: false, limit: null, businessId: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') options.dryRun = true;
    else if (argv[index] === '--limit') options.limit = Number.parseInt(argv[++index], 10);
    else if (argv[index] === '--business-id') options.businessId = argv[++index];
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error('--limit must be a positive integer');
  return options;
}

async function migrate({ dryRun = false, limit = null, businessId = null } = {}) {
  const filter = businessId ? { _id: businessId } : {};
  const businesses = await Business.find(filter).sort({ createdAt: 1 }).limit(limit || 0).select('_id name');
  const report = { dryRun, scanned: businesses.length, created: 0, existing: 0, conflicts: [] };
  for (const business of businesses) {
    const existing = await BusinessSubscription.findOne({ businessId: business._id });
    if (existing) { report.existing += 1; continue; }
    if (dryRun) { report.created += 1; continue; }
    try { await subscriptionService.getOrCreateBusinessSubscription(business._id); report.created += 1; } catch (error) { report.conflicts.push({ businessId: business._id.toString(), name: business.name, code: error.code || 'MIGRATION_ERROR', message: error.message }); }
  }
  return report;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dryRun) { console.info(JSON.stringify(await migrate(options), null, 2)); return; }
  await connectDatabase();
  console.info(JSON.stringify(await migrate(options), null, 2));
}

run().catch((error) => { console.error('Unable to migrate business subscriptions:', error.message); process.exitCode = 1; }).finally(async () => { if (env.mongodbUri) await disconnectDatabase().catch(() => undefined); });

module.exports = { parseArgs, migrate };
