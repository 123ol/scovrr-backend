const mongoose = require('mongoose');
const { INDEX_DEFINITIONS, sameKey, sameOptions } = require('../../../scripts/migrate-launch-indexes');

function collectionDefinitions(definitions) {
  return definitions.reduce((groups, definition) => {
    const current = groups.get(definition.collection) || [];
    current.push(definition);
    groups.set(definition.collection, current);
    return groups;
  }, new Map());
}

function definitionStatus(definition, indexes) {
  const current = indexes.find((index) => sameKey(index.key, definition.key));
  if (!current) return { status: 'missing', name: definition.name };
  if (!sameOptions(current, definition.options)) return { status: 'conflict', name: definition.name, existingName: current.name || null };
  return { status: 'present', name: definition.name, existingName: current.name || null };
}

async function getIndexHealth({
  db = mongoose.connection.db,
  definitions = INDEX_DEFINITIONS,
  connected = mongoose.connection.readyState === 1
} = {}) {
  if (!connected || !db) {
    return {
      status: 'unavailable',
      reason: 'database_disconnected',
      readOnly: true,
      source: 'launch_index_migration',
      collections: [],
      summary: { expected: definitions.length, present: 0, missing: 0, conflicts: 0, errors: 0 },
      asOf: new Date()
    };
  }

  const collections = [];
  for (const [collection, collectionDefinitionsForName] of collectionDefinitions(definitions)) {
    try {
      const indexes = await db.collection(collection).listIndexes().toArray();
      const checks = collectionDefinitionsForName.map((definition) => definitionStatus(definition, indexes));
      collections.push({
        collection,
        status: checks.some((check) => check.status === 'conflict') ? 'conflict' : checks.some((check) => check.status === 'missing') ? 'missing' : 'ok',
        expected: checks.length,
        present: checks.filter((check) => check.status === 'present').length,
        missing: checks.filter((check) => check.status === 'missing').map((check) => check.name),
        conflicts: checks.filter((check) => check.status === 'conflict').map((check) => ({ name: check.name, existingName: check.existingName }))
      });
    } catch (_error) {
      collections.push({ collection, status: 'error', expected: collectionDefinitionsForName.length, present: 0, missing: [], conflicts: [], error: 'INDEX_LIST_FAILED' });
    }
  }

  const summary = collections.reduce((totals, collection) => ({
    expected: totals.expected + collection.expected,
    present: totals.present + collection.present,
    missing: totals.missing + collection.missing.length,
    conflicts: totals.conflicts + collection.conflicts.length,
    errors: totals.errors + (collection.status === 'error' ? 1 : 0)
  }), { expected: 0, present: 0, missing: 0, conflicts: 0, errors: 0 });

  return {
    status: summary.errors > 0 ? 'unavailable' : summary.missing > 0 || summary.conflicts > 0 ? 'degraded' : 'ok',
    readOnly: true,
    source: 'launch_index_migration',
    collections,
    summary,
    asOf: new Date()
  };
}

module.exports = { collectionDefinitions, definitionStatus, getIndexHealth };
