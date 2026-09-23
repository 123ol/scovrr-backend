const { env } = require('../../config/env');
const { AnalyticsEvent } = require('./analytics-event.model');
const { AnalyticsMetricDedupe } = require('./analytics-metric-dedupe.model');

async function runRetention() {
  const now = Date.now();
  const behavioralCutoff = new Date(now - env.analyticsBehavioralRetentionDays * 24 * 60 * 60_000);
  const searchCutoff = new Date(now - env.analyticsSearchRetentionDays * 24 * 60 * 60_000);
  const [behavioral, search, dedupe] = await Promise.all([
    AnalyticsEvent.deleteMany({ retentionClass: { $in: ['behavioral', 'short_behavioral'] }, occurredAt: { $lt: behavioralCutoff } }),
    AnalyticsEvent.deleteMany({ eventName: { $in: ['SEARCH_PERFORMED', 'SEARCH_RESULT_CLICKED'] }, occurredAt: { $lt: searchCutoff } }),
    AnalyticsMetricDedupe.deleteMany({ expiresAt: { $lt: new Date() } })
  ]);
  return { behavioralDeleted: behavioral.deletedCount || 0, searchDeleted: search.deletedCount || 0, dedupeDeleted: dedupe.deletedCount || 0 };
}

module.exports = { runRetention };
