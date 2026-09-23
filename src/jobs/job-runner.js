const { enqueueJob, claimNextJob, completeJob, failJob, workerId } = require('./job.service');

const handlers = {
  notification_push: async (payload) => require('../modules/notifications/notification-delivery.service').deliverNotification(payload.notificationId),
  notification_receipts: async () => require('../modules/notifications/notification-delivery.service').processReceipts(),
  payout_scan: async () => require('../modules/payouts/payout.service').runEligiblePayouts(),
  reconciliation_scan: async () => require('../modules/reconciliation/reconciliation.service').runScheduledReconciliation()
  ,evidence_upload_cleanup: async () => require('../modules/evidence/evidence.service').cleanupExpiredUploads()
  ,discount_reservation_cleanup: async () => require('../modules/promotions/promotion.service').releaseExpiredReservations()
  ,discount_status_scan: async () => require('../modules/promotions/promotion.service').syncPromotionStatuses()
  ,subscription_lifecycle_scan: async () => require('../modules/subscriptions/subscription.service').processSubscriptionLifecycle()
  ,promotion_activation_scan: async () => { const service = require('../modules/advertising/promotion.service'); await service.activateScheduledCampaigns(); await service.completeExpiredCampaigns(); }
  ,promotion_aggregate_scan: async () => require('../modules/advertising/promotion-event.service').aggregatePendingEvents()
  ,analytics_outbox_process: async () => require('../modules/analytics/analytics-outbox.service').processPending()
  ,analytics_projection_process: async () => require('../modules/analytics/analytics-projection.service').processPending()
  ,analytics_retention: async () => require('../modules/analytics/analytics-retention.service').runRetention()
  ,analytics_reconciliation: async () => require('../modules/analytics/analytics-reconciliation.service').reconcileAnalytics()
};

async function processDueJobs(batchSize = 10) {
  const owner = workerId();
  let processed = 0;
  for (let index = 0; index < batchSize; index += 1) {
    const job = await claimNextJob(owner);
    if (!job) break;
    processed += 1;
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
      await handler(job.payload || {});
      await completeJob(job._id, owner);
    } catch (error) {
      await failJob(job._id, owner, error);
    }
  }
  return processed;
}

async function scheduleRecurringJobs({ autoPayouts = false, reconciliation = false } = {}) {
  await enqueueJob({ type: 'notification_receipts', idempotencyKey: `notification-receipts:${Math.floor(Date.now() / 60_000)}` });
  if (autoPayouts) await enqueueJob({ type: 'payout_scan', idempotencyKey: `payout-scan:${Math.floor(Date.now() / 60_000)}` });
  if (reconciliation) await enqueueJob({ type: 'reconciliation_scan', idempotencyKey: `reconciliation-scan:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'evidence_upload_cleanup', idempotencyKey: `evidence-upload-cleanup:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'discount_reservation_cleanup', idempotencyKey: `discount-reservation-cleanup:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'discount_status_scan', idempotencyKey: `discount-status-scan:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'subscription_lifecycle_scan', idempotencyKey: `subscription-lifecycle-scan:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'promotion_activation_scan', idempotencyKey: `promotion-activation-scan:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'promotion_aggregate_scan', idempotencyKey: `promotion-aggregate-scan:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'analytics_outbox_process', idempotencyKey: `analytics-outbox:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'analytics_projection_process', idempotencyKey: `analytics-projection:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'analytics_retention', idempotencyKey: `analytics-retention:${Math.floor(Date.now() / (60 * 60_000))}` });
  await enqueueJob({ type: 'analytics_reconciliation', idempotencyKey: `analytics-reconciliation:${Math.floor(Date.now() / 300_000)}` });
}

function startBackgroundJobs(options = {}) {
  const pollIntervalMs = options.pollIntervalMs || 1_000;
  const recurringIntervalMs = options.recurringIntervalMs || 60_000;
  let running = true;
  const poll = async () => { if (running) await processDueJobs(options.batchSize || 10); };
  const recurring = async () => { if (running) await scheduleRecurringJobs({ autoPayouts: options.autoPayouts, reconciliation: options.reconciliation }); };
  const pollTimer = setInterval(() => { poll().catch((error) => console.error('Background job poll failed:', error.message)); }, pollIntervalMs);
  const recurringTimer = setInterval(() => { recurring().catch((error) => console.error('Background job scheduling failed:', error.message)); }, recurringIntervalMs);
  pollTimer.unref?.();
  recurringTimer.unref?.();
  recurring().catch((error) => console.error('Background job scheduling failed:', error.message));
  return () => { running = false; clearInterval(pollTimer); clearInterval(recurringTimer); };
}

module.exports = { processDueJobs, scheduleRecurringJobs, startBackgroundJobs };
