const { AnalyticsEvent } = require('./analytics-event.model');
const { AnalyticsOutbox } = require('./analytics-outbox.model');
const { AnalyticsProjectionEvent } = require('./analytics-projection-event.model');
const { AnalyticsMetricDedupe } = require('./analytics-metric-dedupe.model');
const { AnalyticsDailyAggregate } = require('./analytics-daily-aggregate.model');
const projectionService = require('./analytics-projection.service');

async function reconcileAnalytics() {
  const [pendingEvents, pendingOutbox, failedOutbox, projectedEvents] = await Promise.all([
    AnalyticsEvent.countDocuments({ aggregatedAt: null }), AnalyticsOutbox.countDocuments({ status: { $in: ['pending', 'processing', 'failed'] } }), AnalyticsOutbox.countDocuments({ status: 'failed' }), AnalyticsProjectionEvent.countDocuments({})
  ]);
  const missingDomainEvents = await AnalyticsOutbox.aggregate([{ $match: { status: 'completed' } }, { $lookup: { from: 'analyticsevents', localField: 'eventKey', foreignField: 'dedupeKey', as: 'events' } }, { $match: { events: { $size: 0 } } }, { $count: 'count' }]);
  return { pendingEvents, pendingOutbox, failedOutbox, projectedEvents, missingDomainEvents: missingDomainEvents[0]?.count || 0, checkedAt: new Date() };
}

async function rebuildBehavioralProjections({ from, to, dryRun = true } = {}) {
  if (!from || !to || new Date(from) >= new Date(to)) throw new Error('A valid rebuild range is required');
  const report = { dryRun, events: null, from: new Date(from), to: new Date(to) };
  if (dryRun) return report;
  const filter = { occurredAt: { $gte: new Date(from), $lt: new Date(to) } };
  const events = await AnalyticsEvent.find(filter).select('_id eventId occurredAt');
  report.events = events.length;
  const days = [...new Set(events.map((event) => event.occurredAt.toISOString().slice(0, 10)))];
  await Promise.all([
    AnalyticsDailyAggregate.deleteMany({ dateKey: { $in: days } }),
    AnalyticsProjectionEvent.deleteMany({ eventId: { $in: events.map((event) => event.eventId) } }),
    AnalyticsMetricDedupe.deleteMany({ createdAt: { $gte: new Date(from), $lt: new Date(to) } })
  ]);
  await AnalyticsEvent.updateMany({ _id: { $in: events.map((event) => event._id) } }, { $set: { aggregatedAt: null } });
  let projected = 0;
  while (await projectionService.processPending(500, filter)) projected += 1;
  return { ...report, projected };
}

module.exports = { reconcileAnalytics, rebuildBehavioralProjections };
