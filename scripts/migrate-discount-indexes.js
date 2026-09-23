const { connectDatabase, disconnectDatabase } = require('../src/config/database');

function sameKey(left = {}, right = {}) { const a = Object.entries(left); const b = Object.entries(right); return a.length === b.length && a.every(([field, direction], index) => b[index]?.[0] === field && b[index]?.[1] === direction); }

async function runDiscountIndexMigration({ dryRun = false, db, logger = console } = {}) {
  if (!db) throw new Error('A MongoDB database handle is required');
  const report = { dryRun, droppedLegacyUniqueOrderIndexes: [], existing: [], created: [] };
  const redemptions = db.collection('promotionredemptions');
  const indexes = await redemptions.listIndexes().toArray();
  for (const index of indexes.filter((item) => item.unique && sameKey(item.key, { orderId: 1 }))) {
    if (!dryRun) await redemptions.dropIndex(index.name);
    report.droppedLegacyUniqueOrderIndexes.push(index.name);
  }
  const definitions = [
    { collection: redemptions, name: 'promotion_redemption_order_status', key: { orderId: 1, status: 1 } },
    { collection: redemptions, name: 'promotion_redemption_booking_status', key: { bookingId: 1, status: 1 } },
    { collection: db.collection('promotioncustomerusages'), name: 'promotion_customer_usage_unique', key: { promotionId: 1, customerId: 1 }, options: { unique: true } },
    { collection: db.collection('couponcodes'), name: 'coupon_code_unique', key: { code: 1 }, options: { unique: true } }
  ];
  for (const definition of definitions) {
    const current = await definition.collection.listIndexes().toArray();
    const match = current.find((index) => sameKey(index.key, definition.key));
    if (match) { report.existing.push({ collection: definition.collection.collectionName, name: match.name }); continue; }
    if (!dryRun) await definition.collection.createIndex(definition.key, { ...(definition.options || {}), name: definition.name });
    report.created.push({ collection: definition.collection.collectionName, name: definition.name });
  }
  logger.info(`${dryRun ? 'Would apply' : 'Applied'} discount indexes`);
  return report;
}

async function main() { const dryRun = process.argv.includes('--dry-run'); await connectDatabase(); try { const report = await runDiscountIndexMigration({ dryRun, db: require('mongoose').connection.db }); console.log(JSON.stringify(report, null, 2)); } finally { await disconnectDatabase(); } }
if (require.main === module) main().catch((error) => { console.error(`Discount index migration failed: ${error.message}`); process.exitCode = 1; });
module.exports = { sameKey, runDiscountIndexMigration };
