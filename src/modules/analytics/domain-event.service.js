const { enqueueDomainEvent } = require('./analytics-outbox.service');

async function queue(eventName, payload, eventKey) {
  try { return await enqueueDomainEvent(eventName, payload, eventKey); } catch (error) { console.error(`Unable to queue analytics ${eventName}:`, error.message); return null; }
}

module.exports = { queue };
