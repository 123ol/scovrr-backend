const { AppError } = require('../../common/errors/AppError');
const { Notification } = require('./notification.model');
const { DeviceToken } = require('./device-token.model');
const { enqueueNotificationDelivery } = require('./notification-delivery.service');

async function createNotification(input) { const notification = input.deduplicationKey ? await Notification.findOneAndUpdate({ deduplicationKey: input.deduplicationKey }, { $setOnInsert: input }, { upsert: true, new: true, setDefaultsOnInsert: true }) : await Notification.create(input); await enqueueNotificationDelivery(notification); return notification; }
async function listNotifications(userId, query) {
  const filter = { userId, ...(query.unreadOnly === 'true' ? { readAt: null } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [items, total, unread] = await Promise.all([Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Notification.countDocuments(filter), Notification.countDocuments({ userId, readAt: null })]);
  return { notifications: items.map((item) => item.toSafeJSON()), unread, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}
async function markRead(userId, notificationId) { const item = await Notification.findOneAndUpdate({ _id: notificationId, userId }, { $set: { readAt: new Date() } }, { new: true }); if (!item) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found'); return item; }
async function registerDevice(userId, input) { return DeviceToken.findOneAndUpdate({ userId, token: input.token }, { $set: { ...input, userId, active: true, lastSeenAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true }); }
async function removeDevice(userId, token) { await DeviceToken.deleteOne({ userId, token }); }

module.exports = { createNotification, listNotifications, markRead, registerDevice, removeDevice };
