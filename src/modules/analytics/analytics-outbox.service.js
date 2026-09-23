const crypto = require('node:crypto');
const { AnalyticsOutbox } = require('./analytics-outbox.model');

function workerId() { return `analytics-${process.pid}-${crypto.randomBytes(4).toString('hex')}`; }

async function enqueueDomainEvent(eventName, payload = {}, eventKey) {
  const key = eventKey || `${eventName}:${payload.entityId || payload.orderId || payload.bookingId || crypto.randomUUID()}`;
  try {
    return await AnalyticsOutbox.create({ eventKey: key, eventName, payload, status: 'pending', nextAttemptAt: new Date() });
  } catch (error) {
    if (error?.code === 11000) return AnalyticsOutbox.findOne({ eventKey: key });
    throw error;
  }
}

async function processPending(limit = 100) {
  const owner = workerId();
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const item = await AnalyticsOutbox.findOneAndUpdate(
      { status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: new Date() }, $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - 5 * 60_000) } }] },
      { $set: { status: 'processing', lockedBy: owner, lockedAt: new Date() }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, new: true }
    );
    if (!item) break;
    try {
      const analyticsService = require('./analytics.service');
      await analyticsService.recordAuthoritativeEvent(item.eventName, { ...item.payload, dedupeKey: item.eventKey });
      await AnalyticsOutbox.updateOne({ _id: item._id, lockedBy: owner }, { $set: { status: 'completed', processedAt: new Date(), lockedBy: null, lockedAt: null, lastError: null } });
      processed += 1;
    } catch (error) {
      const delay = Math.min(60 * 60_000, 1_000 * (2 ** Math.min(item.attempts, 10)));
      await AnalyticsOutbox.updateOne({ _id: item._id, lockedBy: owner }, { $set: { status: 'failed', nextAttemptAt: new Date(Date.now() + delay), lockedBy: null, lockedAt: null, lastError: error.message.slice(0, 1_000) } });
    }
  }
  return processed;
}

module.exports = { enqueueDomainEvent, processPending };
