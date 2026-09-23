const { connectDatabase, disconnectDatabase } = require('../src/config/database');

const INDEX_DEFINITIONS = [
  {
    collection: 'orders',
    name: 'order_customer_checkout_idempotency_unique',
    key: { customerId: 1, checkoutIdempotencyKey: 1 },
    options: { unique: true, partialFilterExpression: { checkoutIdempotencyKey: { $type: 'string' } } }
  },
  {
    collection: 'conversations',
    name: 'conversation_key_unique',
    key: { conversationKey: 1 },
    options: { unique: true, sparse: true }
  },
  {
    collection: 'catalogueuploadsessions',
    name: 'catalogue_upload_session_expiry',
    key: { expiresAt: 1 },
    options: { expireAfterSeconds: 0 }
  },
  {
    collection: 'cataloguemediaassets',
    name: 'catalogue_media_asset_business_public_id_unique',
    key: { businessId: 1, publicId: 1 },
    options: { unique: true }
  },
  {
    collection: 'contentposts',
    name: 'content_post_business_status_created',
    key: { businessId: 1, status: 1, createdAt: -1 },
    options: {}
  },
  {
    collection: 'contentposts',
    name: 'content_post_status_moderation_created',
    key: { status: 1, moderationStatus: 1, createdAt: -1 },
    options: {}
  },
  {
    collection: 'contentpostcomments',
    name: 'content_post_comment_post_status_created',
    key: { postId: 1, status: 1, createdAt: 1 },
    options: {}
  },
  {
    collection: 'paymentevents',
    name: 'payment_event_provider_event_unique',
    key: { provider: 1, eventId: 1 },
    options: { unique: true }
  }
];

function normalized(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalized(item)]));
  }
  if (Array.isArray(value)) return value.map(normalized);
  return value;
}

function sameKey(left = {}, right = {}) {
  const a = Object.entries(left);
  const b = Object.entries(right);
  return a.length === b.length && a.every(([field, direction], index) => b[index]?.[0] === field && b[index]?.[1] === direction);
}

function sameOptions(current = {}, expected = {}) {
  for (const option of ['unique', 'sparse', 'expireAfterSeconds']) {
    if (expected[option] !== undefined && Boolean(current[option]) !== Boolean(expected[option])) return false;
  }
  if (expected.expireAfterSeconds !== undefined && current.expireAfterSeconds !== expected.expireAfterSeconds) return false;
  if (expected.partialFilterExpression !== undefined && JSON.stringify(normalized(current.partialFilterExpression || {})) !== JSON.stringify(normalized(expected.partialFilterExpression))) return false;
  return true;
}

async function runIndexMigration({ dryRun = true, db, logger = console } = {}) {
  if (!db) throw new Error('A MongoDB database handle is required');
  const report = { dryRun, created: [], existing: [], conflicts: [] };
  for (const definition of INDEX_DEFINITIONS) {
    const collection = db.collection(definition.collection);
    const indexes = await collection.listIndexes().toArray();
    const current = indexes.find((item) => sameKey(item.key, definition.key));
    if (current) {
      if (!sameOptions(current, definition.options)) {
        report.conflicts.push({ collection: definition.collection, name: definition.name, existing: current.name, reason: 'INDEX_OPTIONS_MISMATCH' });
      } else {
        report.existing.push({ collection: definition.collection, name: current.name });
      }
      continue;
    }
    if (!dryRun) await collection.createIndex(definition.key, { ...definition.options, name: definition.name });
    report.created.push({ collection: definition.collection, name: definition.name });
  }
  logger.info(`${dryRun ? 'Would apply' : 'Applied'} launch indexes`);
  return report;
}

async function main() {
  const dryRun = !process.argv.includes('--apply');
  await connectDatabase();
  try {
    const report = await runIndexMigration({ dryRun, db: require('mongoose').connection.db });
    console.log(JSON.stringify(report, null, 2));
    if (report.conflicts.length > 0) process.exitCode = 2;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(`Launch index migration failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { INDEX_DEFINITIONS, normalized, sameKey, sameOptions, runIndexMigration };
