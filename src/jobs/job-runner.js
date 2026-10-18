const { enqueueJob, claimNextJob, completeJob, failJob, workerId } = require('./job.service');
const { logger } = require('../common/observability/logger');
const { recordJobUsage } = require('../common/observability/resource-metrics');
const { markSchedulerStarted, markSchedulerStopped, markPollStarted, markPollCompleted, markPollFailed, markRecurringStarted, markRecurringCompleted, markRecurringFailed } = require('../common/observability/scheduler-metrics');

function singleFlight(task) {
  let activePromise = null;
  return (...args) => {
    if (activePromise) return activePromise;
    activePromise = Promise.resolve().then(() => task(...args)).finally(() => { activePromise = null; });
    return activePromise;
  };
}

const handlers = {
  notification_push: async (payload) => require('../modules/notifications/notification-delivery.service').deliverNotification(payload.notificationId),
  notification_receipts: async () => require('../modules/notifications/notification-delivery.service').processReceipts(),
  account_export: async (payload) => require('../modules/auth/auth.service').processAccountExport(payload.exportJobId),
  product_import: async (payload) => require('../modules/products/product-import.service').processCsvImport(payload.productImportJobId),
  payout_scan: async () => require('../modules/payouts/payout.service').runEligiblePayouts(),
  reconciliation_scan: async () => require('../modules/reconciliation/reconciliation.service').runScheduledReconciliation()
  ,evidence_upload_cleanup: async () => require('../modules/evidence/evidence.service').cleanupExpiredUploads()
  ,evidence_retention_cleanup: async () => require('../modules/evidence/evidence.service').cleanupExpiredEvidence()
  ,discount_reservation_cleanup: async () => require('../modules/promotions/promotion.service').releaseExpiredReservations()
  ,discount_status_scan: async () => require('../modules/promotions/promotion.service').syncPromotionStatuses()
  ,subscription_lifecycle_scan: async () => require('../modules/subscriptions/subscription.service').processSubscriptionLifecycle()
  ,promotion_activation_scan: async () => { const service = require('../modules/advertising/promotion.service'); await service.activateScheduledCampaigns(); await service.completeExpiredCampaigns(); }
  ,promotion_aggregate_scan: async () => require('../modules/advertising/promotion-event.service').aggregatePendingEvents()
  ,analytics_outbox_process: async () => require('../modules/analytics/analytics-outbox.service').processPending()
  ,analytics_projection_process: async () => require('../modules/analytics/analytics-projection.service').processPending()
  ,analytics_retention: async () => require('../modules/analytics/analytics-retention.service').runRetention()
  ,analytics_reconciliation: async () => require('../modules/analytics/analytics-reconciliation.service').reconcileAnalytics()
  ,booking_reminder_scan: async () => require('../modules/bookings/booking.service').processBookingReminders()
  ,waitlist_offer_expiry_scan: async () => require('../modules/bookings/booking-waitlist.service').expireWaitlistOffers()
  ,abandoned_cart_scan: async () => require('../modules/cart/cart.service').processAbandonedCartReminders()
  ,inventory_low_stock_scan: async () => require('../modules/inventory/inventory.service').processLowStockAlerts()
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
      recordJobUsage();
    } catch (error) {
      recordJobUsage({ failed: true });
      try {
        await failJob(job._id, owner, error);
      } catch (failureError) {
        logger.error('jobs.failure_recording.failed', { jobId: job._id?.toString(), error: { name: failureError.name, code: failureError.code, message: failureError.message } });
      }
    }
  }
  return processed;
}

async function scheduleRecurringJobs({ autoPayouts = false, reconciliation = false } = {}) {
  await enqueueJob({ type: 'notification_receipts', idempotencyKey: `notification-receipts:${Math.floor(Date.now() / 60_000)}` });
  if (autoPayouts) await enqueueJob({ type: 'payout_scan', idempotencyKey: `payout-scan:${Math.floor(Date.now() / 60_000)}` });
  if (reconciliation) await enqueueJob({ type: 'reconciliation_scan', idempotencyKey: `reconciliation-scan:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'evidence_upload_cleanup', idempotencyKey: `evidence-upload-cleanup:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'evidence_retention_cleanup', idempotencyKey: `evidence-retention-cleanup:${Math.floor(Date.now() / 3_600_000)}` });
  await enqueueJob({ type: 'discount_reservation_cleanup', idempotencyKey: `discount-reservation-cleanup:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'discount_status_scan', idempotencyKey: `discount-status-scan:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'subscription_lifecycle_scan', idempotencyKey: `subscription-lifecycle-scan:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'promotion_activation_scan', idempotencyKey: `promotion-activation-scan:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'promotion_aggregate_scan', idempotencyKey: `promotion-aggregate-scan:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'analytics_outbox_process', idempotencyKey: `analytics-outbox:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'analytics_projection_process', idempotencyKey: `analytics-projection:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'analytics_retention', idempotencyKey: `analytics-retention:${Math.floor(Date.now() / (60 * 60_000))}` });
  await enqueueJob({ type: 'analytics_reconciliation', idempotencyKey: `analytics-reconciliation:${Math.floor(Date.now() / 300_000)}` });
  await enqueueJob({ type: 'booking_reminder_scan', idempotencyKey: `booking-reminders:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'waitlist_offer_expiry_scan', idempotencyKey: `waitlist-offer-expiry:${Math.floor(Date.now() / 60_000)}` });
  await enqueueJob({ type: 'abandoned_cart_scan', idempotencyKey: `abandoned-carts:${Math.floor(Date.now() / (60 * 60_000))}` });
  await enqueueJob({ type: 'inventory_low_stock_scan', idempotencyKey: `inventory-low-stock:${Math.floor(Date.now() / (60 * 60_000))}` });
}

function startBackgroundJobs(options = {}) {
  const pollIntervalMs = options.pollIntervalMs || 1_000;
  const recurringIntervalMs = options.recurringIntervalMs || 60_000;
  let running = true;
  const poll = singleFlight(async () => {
    if (!running) return 0;
    markPollStarted();
    try {
      const processed = await (options.processDueJobs || processDueJobs)(options.batchSize || 10);
      markPollCompleted(processed);
      return processed;
    } catch (error) {
      markPollFailed();
      throw error;
    }
  });
  const recurring = singleFlight(async () => {
    if (!running) return;
    markRecurringStarted();
    try {
      await (options.scheduleRecurringJobs || scheduleRecurringJobs)({ autoPayouts: options.autoPayouts, reconciliation: options.reconciliation });
      markRecurringCompleted();
    } catch (error) {
      markRecurringFailed();
      throw error;
    }
  });
  markSchedulerStarted();
  const pollTimer = setInterval(() => { poll().catch((error) => logger.error('jobs.poll.failed', { error: { name: error.name, code: error.code, message: error.message } })); }, pollIntervalMs);
  const recurringTimer = setInterval(() => { recurring().catch((error) => logger.error('jobs.schedule.failed', { error: { name: error.name, code: error.code, message: error.message } })); }, recurringIntervalMs);
  pollTimer.unref?.();
  recurringTimer.unref?.();
  recurring().catch((error) => logger.error('jobs.schedule.failed', { error: { name: error.name, code: error.code, message: error.message } }));
  return () => { running = false; markSchedulerStopped(); clearInterval(pollTimer); clearInterval(recurringTimer); };
}

module.exports = { processDueJobs, scheduleRecurringJobs, startBackgroundJobs, singleFlight };
