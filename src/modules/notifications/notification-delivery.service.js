const { Notification } = require('./notification.model');
const { DeviceToken } = require('./device-token.model');
const { NotificationDelivery } = require('./notification-delivery.model');
const { enqueueJob } = require('../../jobs/job.service');
const { getPushProvider } = require('../../integrations/notifications');
const { logger } = require('../../common/observability/logger');

const MAX_DELIVERY_ATTEMPTS = 5;
const PERMANENT_PUSH_ERRORS = new Set(['DeviceNotRegistered', 'MessageTooBig', 'InvalidCredentials']);

function nextAttempt(attempts, now = Date.now()) {
  return new Date(now + Math.min(15 * 60 * 1_000, 1_000 * (2 ** Math.max(attempts - 1, 0))));
}

function pushErrorCode(value) {
  return value?.details?.error || value?.code || null;
}

function notificationContinuationIdempotencyKey(notificationId, runAt = new Date()) {
  return `notification-push:${notificationId}:continuation:${Math.floor(new Date(runAt).getTime() / 1_000)}`;
}

function deliveryFailureState(attempts, errorCode, now = Date.now()) {
  const dead = PERMANENT_PUSH_ERRORS.has(errorCode) || attempts >= MAX_DELIVERY_ATTEMPTS;
  return {
    status: dead ? 'dead' : 'failed',
    nextAttemptAt: dead ? null : nextAttempt(attempts, now),
    dead
  };
}

async function ensureDeliveries(notification) {
  const devices = await DeviceToken.find({ userId: notification.userId, active: true }).select('_id token');
  if (devices.length) {
    await NotificationDelivery.bulkWrite(devices.map((device) => ({ updateOne: { filter: { notificationId: notification._id, deviceTokenId: device._id }, update: { $setOnInsert: { notificationId: notification._id, userId: notification.userId, deviceTokenId: device._id, status: 'queued' } }, upsert: true } })));
  }
  return devices;
}

async function enqueueNotificationDelivery(notification) {
  return enqueueJob({ type: 'notification_push', payload: { notificationId: notification._id.toString() }, idempotencyKey: `notification-push:${notification._id}` });
}

async function deliverNotification(notificationId) {
  const notification = await Notification.findById(notificationId);
  if (!notification) return { skipped: true, reason: 'notification_not_found' };
  await ensureDeliveries(notification);
  const deliveries = await NotificationDelivery.find({ notificationId, $or: [{ status: 'queued', $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: new Date() } }] }, { status: 'failed', nextAttemptAt: { $lte: new Date() } }] }).sort({ createdAt: 1 }).limit(500);
  if (!deliveries.length) return { delivered: 0 };
  const deviceIds = deliveries.map((delivery) => delivery.deviceTokenId);
  const devices = await DeviceToken.find({ _id: { $in: deviceIds }, active: true }).select('_id token');
  const deviceMap = new Map(devices.map((device) => [device._id.toString(), device]));
  const activeDeliveries = deliveries.filter((delivery) => deviceMap.has(delivery.deviceTokenId.toString()));
  const orphanIds = deliveries.filter((delivery) => !deviceMap.has(delivery.deviceTokenId.toString())).map((delivery) => delivery._id);
  if (orphanIds.length) await NotificationDelivery.updateMany({ _id: { $in: orphanIds } }, { $set: { status: 'dead', lastError: 'Device token is no longer active' } });
  if (!activeDeliveries.length) return { delivered: 0 };
  const provider = getPushProvider();
  const messages = activeDeliveries.map((delivery) => ({ to: deviceMap.get(delivery.deviceTokenId.toString()).token, title: notification.title, body: notification.body, data: notification.data || {}, sound: 'default' }));
  let tickets;
  try {
    tickets = await provider.sendMessages(messages);
  } catch (error) {
    if (error?.code === 'PUSH_PROVIDER_NOT_CONFIGURED') throw error;
    const errorCode = pushErrorCode(error) || 'PUSH_PROVIDER_ERROR';
    logger.warn('notifications.push.provider_failed', { notificationId: notification._id.toString(), attempted: activeDeliveries.length, errorCode });
    await Promise.all(activeDeliveries.map((delivery) => {
      const attempts = delivery.attempts + 1;
      const state = deliveryFailureState(attempts, errorCode);
      return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: state.status, lastError: error.message || 'Push provider request failed', nextAttemptAt: state.nextAttemptAt }, $inc: { attempts: 1 } });
    }));
    const retryAt = new Date(Date.now() + 1_000);
    if (activeDeliveries.some((delivery) => deliveryFailureState(delivery.attempts + 1, errorCode).status === 'failed')) {
      await enqueueJob({ type: 'notification_push', payload: { notificationId: notification._id.toString() }, idempotencyKey: `notification-push:${notification._id}:provider-retry:${Math.floor(retryAt.getTime() / 1_000)}`, runAt: retryAt });
    }
    return { delivered: 0, attempted: activeDeliveries.length, failed: activeDeliveries.length };
  }
  await Promise.all(activeDeliveries.map(async (delivery, index) => {
    const ticket = tickets[index] || { status: 'error', message: 'No Expo ticket was returned' };
    const attempts = delivery.attempts + 1;
    if (ticket.status === 'ok') return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: 'sent', expoTicketId: ticket.id || null, receiptStatus: 'pending', sentAt: new Date(), lastError: null, nextAttemptAt: null }, $inc: { attempts: 1 } });
    const errorCode = pushErrorCode(ticket);
    const invalidToken = errorCode === 'DeviceNotRegistered';
    if (invalidToken) await DeviceToken.findByIdAndUpdate(delivery.deviceTokenId, { $set: { active: false } });
    const state = deliveryFailureState(attempts, errorCode);
    return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: state.status, lastError: ticket.message || errorCode || 'Expo rejected the notification', nextAttemptAt: state.nextAttemptAt }, $inc: { attempts: 1 } });
  }));
  const remaining = await NotificationDelivery.countDocuments({ notificationId, status: { $in: ['queued', 'failed'] } });
  if (remaining) {
    const retryAt = new Date(Date.now() + 1_000);
    await enqueueJob({ type: 'notification_push', payload: { notificationId: notification._id.toString() }, idempotencyKey: notificationContinuationIdempotencyKey(notification._id, retryAt), runAt: retryAt });
  }
  return { delivered: tickets.filter((ticket) => ticket.status === 'ok').length, attempted: tickets.length };
}

async function processReceipts() {
  const deliveries = await NotificationDelivery.find({ status: 'sent', expoTicketId: { $ne: null }, receiptCheckedAt: null }).sort({ sentAt: 1 }).limit(500);
  if (!deliveries.length) return { checked: 0 };
  const provider = getPushProvider();
  const receipts = await provider.getReceipts(deliveries.map((delivery) => delivery.expoTicketId));
  await Promise.all(deliveries.map(async (delivery) => {
    const receipt = receipts[delivery.expoTicketId];
    if (!receipt) return null;
    const errorCode = pushErrorCode(receipt);
    const invalidToken = errorCode === 'DeviceNotRegistered';
    if (invalidToken) await DeviceToken.findByIdAndUpdate(delivery.deviceTokenId, { $set: { active: false } });
    if (receipt.status === 'ok') return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { receiptStatus: 'ok', receiptError: null, receiptCheckedAt: new Date() } });
    const state = deliveryFailureState(delivery.attempts, errorCode);
    return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: state.status, receiptStatus: receipt.status || 'error', receiptError: receipt.message || errorCode || 'Push receipt reported an error', receiptCheckedAt: new Date(), expoTicketId: null, nextAttemptAt: state.nextAttemptAt } });
  }));
  return { checked: deliveries.length };
}

module.exports = { ensureDeliveries, enqueueNotificationDelivery, deliverNotification, processReceipts, MAX_DELIVERY_ATTEMPTS, deliveryFailureState, pushErrorCode, notificationContinuationIdempotencyKey, PERMANENT_PUSH_ERRORS };
