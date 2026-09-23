const { connectDatabase, disconnectDatabase } = require('../src/config/database');

const INDEX_DEFINITIONS = [
  { collection: 'availabilityrules', name: 'availability_business_location_staff_unique', key: { businessId: 1, locationId: 1, staffUserId: 1 }, options: { unique: true } },
  { collection: 'blockedperiods', name: 'blocked_business_active_location_staff_window', key: { businessId: 1, active: 1, locationId: 1, staffUserId: 1, startAt: 1, endAt: 1 }, options: {} },
  { collection: 'bookings', name: 'booking_business_location_staff_status_window', key: { businessId: 1, locationId: 1, staffUserId: 1, status: 1, startAt: 1, endAt: 1 }, options: {} },
  { collection: 'bookingslotlocks', name: 'booking_lock_business_location_staff_bucket', key: { businessId: 1, locationId: 1, staffUserId: 1, bucketStart: 1 }, options: {} }
];

function sameKey(left = {}, right = {}) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return leftEntries.length === rightEntries.length && leftEntries.every(([field, direction], index) => rightEntries[index]?.[0] === field && rightEntries[index]?.[1] === direction);
}

function isLegacyAvailabilityIndex(index) {
  return sameKey(index.key, { businessId: 1, staffUserId: 1 });
}

async function duplicateAvailabilityGroups(collection) {
  return collection.aggregate([
    { $project: { businessId: 1, locationId: { $ifNull: ['$locationId', null] }, staffUserId: { $ifNull: ['$staffUserId', null] } } },
    { $group: { _id: { businessId: '$businessId', locationId: '$locationId', staffUserId: '$staffUserId' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 100 }
  ]).toArray();
}

async function runIndexMigration({ dryRun = false, db, logger = console } = {}) {
  if (!db) throw new Error('A MongoDB database handle is required');
  const report = { dryRun, created: [], existing: [], droppedLegacyAvailabilityIndexes: [], conflicts: [], duplicateAvailabilityGroups: [] };
  const availabilityCollection = db.collection('availabilityrules');
  report.duplicateAvailabilityGroups = await duplicateAvailabilityGroups(availabilityCollection);
  if (report.duplicateAvailabilityGroups.length > 0) {
    report.conflicts.push({ code: 'DUPLICATE_AVAILABILITY_RULES', count: report.duplicateAvailabilityGroups.length, samples: report.duplicateAvailabilityGroups.slice(0, 10) });
    return report;
  }

  const pending = [];
  for (const definition of INDEX_DEFINITIONS) {
    const collection = db.collection(definition.collection);
    const indexes = await collection.listIndexes().toArray();
    const sameKeyIndex = indexes.find((index) => sameKey(index.key, definition.key));
    if (sameKeyIndex) {
      if (definition.options.unique === true && sameKeyIndex.unique !== true) {
        report.conflicts.push({ code: 'INDEX_UNIQUENESS_MISMATCH', collection: definition.collection, expected: definition.name, existing: sameKeyIndex.name });
      } else {
        report.existing.push({ collection: definition.collection, name: sameKeyIndex.name, purpose: definition.name });
      }
      continue;
    }
    pending.push({ collection, definition });
  }

  if (report.conflicts.length > 0) return report;

  for (const { collection, definition } of pending) {
    if (!dryRun) await collection.createIndex(definition.key, { ...definition.options, name: definition.name });
    report.created.push({ collection: definition.collection, name: definition.name, key: definition.key, options: definition.options });
  }

  const currentAvailabilityIndexes = await availabilityCollection.listIndexes().toArray();
  const legacyIndexes = currentAvailabilityIndexes.filter(isLegacyAvailabilityIndex);
  if (legacyIndexes.length > 0) {
    if (dryRun) report.droppedLegacyAvailabilityIndexes = legacyIndexes.map((index) => index.name);
    else {
      for (const index of legacyIndexes) {
        await availabilityCollection.dropIndex(index.name);
        report.droppedLegacyAvailabilityIndexes.push(index.name);
      }
    }
  }
  logger.info(`${dryRun ? 'Would apply' : 'Applied'} ${report.created.length} Business Scale indexes`);
  return report;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDatabase();
  try {
    const report = await runIndexMigration({ dryRun, db: require('mongoose').connection.db });
    console.log(JSON.stringify(report, null, 2));
    if (report.conflicts.length > 0) process.exitCode = 2;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Business Scale index migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { INDEX_DEFINITIONS, sameKey, isLegacyAvailabilityIndex, duplicateAvailabilityGroups, runIndexMigration };
