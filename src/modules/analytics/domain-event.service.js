const { enqueueDomainEvent } = require('./analytics-outbox.service');
const { logger } = require('../../common/observability/logger');

async function queue(eventName, payload, eventKey) {
  try { return await enqueueDomainEvent(eventName, payload, eventKey); } catch (error) { logger.error('analytics.domain_event.failed', { eventName, error: { name: error.name, code: error.code, message: error.message } }); return null; }
}

module.exports = { queue };
