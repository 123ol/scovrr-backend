const { Notification } = require('./notification.model');
const { DeviceToken } = require('./device-token.model');
const { NotificationDelivery } = require('./notification-delivery.model');
const { enqueueJob } = require('../../jobs/job.service');
const { getPushProvider } = require('../../integrations/notifications');

const MAX_DELIVERY_ATTEMPTS = 5;

function nextAttempt(attempts) {
  return new Date(Date.now() + Math.min(15 * 60 * 1_000, 1_000 * (2 ** Math.max(attempts - 1, 0))));
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
  const tickets = await provider.sendMessages(messages);
  await Promise.all(activeDeliveries.map(async (delivery, index) => {
    const ticket = tickets[index] || { status: 'error', message: 'No Expo ticket was returned' };
    const attempts = delivery.attempts + 1;
    if (ticket.status === 'ok') return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: 'sent', expoTicketId: ticket.id || null, receiptStatus: 'pending', sentAt: new Date(), lastError: null, nextAttemptAt: null }, $inc: { attempts: 1 } });
    const invalidToken = ticket.details?.error === 'DeviceNotRegistered';
    if (invalidToken) await DeviceToken.findByIdAndUpdate(delivery.deviceTokenId, { $set: { active: false } });
    const dead = invalidToken || attempts >= MAX_DELIVERY_ATTEMPTS;
    return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: dead ? 'dead' : 'queued', lastError: ticket.message || ticket.details?.error || 'Expo rejected the notification', nextAttemptAt: dead ? null : nextAttempt(attempts) }, $inc: { attempts: 1 } });
  }));
  const remaining = await NotificationDelivery.countDocuments({ notificationId, status: { $in: ['queued', 'failed'] } });
  if (remaining) await enqueueJob({ type: 'notification_push', payload: { notificationId: notification._id.toString() }, idempotencyKey: `notification-push:${notification._id}:continuation:${Math.floor(Date.now() / 60_000)}`, runAt: new Date(Date.now() + 1_000) });
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
    const invalidToken = receipt.details?.error === 'DeviceNotRegistered';
    if (invalidToken) await DeviceToken.findByIdAndUpdate(delivery.deviceTokenId, { $set: { active: false } });
    return NotificationDelivery.findByIdAndUpdate(delivery._id, { $set: { status: invalidToken ? 'dead' : delivery.status, receiptStatus: receipt.status || 'error', receiptError: receipt.message || receipt.details?.error || null, receiptCheckedAt: new Date() } });
  }));
  return { checked: deliveries.length };
}

module.exports = { ensureDeliveries, enqueueNotificationDelivery, deliverNotification, processReceipts, MAX_DELIVERY_ATTEMPTS };
