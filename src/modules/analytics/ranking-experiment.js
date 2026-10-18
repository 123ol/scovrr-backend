const crypto = require('node:crypto');

const EXPERIMENTS = Object.freeze({
  recommendation_ranking_v1: Object.freeze({
    version: 1,
    variants: Object.freeze([
      Object.freeze({ key: 'control', weight: 50 }),
      Object.freeze({ key: 'behavioral', weight: 50 })
    ])
  })
});

function getExperiment(experimentKey) {
  return EXPERIMENTS[experimentKey] || null;
}

function bucketFor(experimentKey, version, subjectId) {
  const digest = crypto.createHash('sha256').update(`${experimentKey}:${version}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 10_000;
}

function assignRankingVariant({ experimentKey = 'recommendation_ranking_v1', subjectId } = {}) {
  const experiment = getExperiment(experimentKey);
  if (!experiment || !subjectId) return null;
  const bucket = bucketFor(experimentKey, experiment.version, String(subjectId));
  const threshold = bucket / 100;
  let cursor = 0;
  const selected = experiment.variants.find((variant) => {
    cursor += variant.weight;
    return threshold < cursor;
  }) || experiment.variants.at(-1);
  return { key: experimentKey, version: experiment.version, variant: selected.key, bucket };
}

function rankWithVariant(items, profile, limit, assignment, ranker) {
  if (assignment?.variant === 'control') return items.slice(0, limit);
  return ranker(items, profile, limit);
}

module.exports = { EXPERIMENTS, getExperiment, bucketFor, assignRankingVariant, rankWithVariant };
