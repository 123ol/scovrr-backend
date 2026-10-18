const { AppError } = require('../../common/errors/AppError');
const { Notification } = require('./notification.model');
const { DeviceToken } = require('./device-token.model');
const { enqueueNotificationDelivery } = require('./notification-delivery.service');
const { User } = require('../users/user.model');

function preferenceForType(type = '') {
  if (/security|account/i.test(type)) return 'security';
  if (/message|conversation/i.test(type)) return 'messages';
  if (/booking/i.test(type)) return 'bookingUpdates';
  if (/marketing|promotion|campaign/i.test(type)) return 'marketing';
  return 'orderUpdates';
}

async function notificationAllowed(userId, type) {
  const user = await User.findById(userId).select('notificationPreferences').lean();
  const preference = preferenceForType(type);
  return user?.notificationPreferences?.[preference] !== false;
}

async function createNotification(input) {
  if (!(await notificationAllowed(input.userId, input.type))) return null;
  let notification;
  let created = true;
  if (input.deduplicationKey) {
    notification = await Notification.findOne({ deduplicationKey: input.deduplicationKey });
    if (notification) created = false;
    else {
      try {
        notification = await Notification.create(input);
      } catch (error) {
        if (error?.code !== 11000) throw error;
        notification = await Notification.findOne({ deduplicationKey: input.deduplicationKey });
        created = false;
      }
    }
  } else notification = await Notification.create(input);
  if (created && notification) await enqueueNotificationDelivery(notification);
  return notification;
}
async function listNotifications(userId, query) {
  const filter = { userId, ...(query.unreadOnly === 'true' ? { readAt: null } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [items, total, unread] = await Promise.all([Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Notification.countDocuments(filter), Notification.countDocuments({ userId, readAt: null })]);
  return { notifications: items.map((item) => item.toSafeJSON()), unread, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}
async function markRead(userId, notificationId) { const item = await Notification.findOneAndUpdate({ _id: notificationId, userId }, { $set: { readAt: new Date() } }, { new: true }); if (!item) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found'); return item; }
async function registerDevice(userId, input) { return DeviceToken.findOneAndUpdate({ userId, token: input.token }, { $set: { ...input, userId, active: true, lastSeenAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true }); }
async function removeDevice(userId, token) { await DeviceToken.deleteOne({ userId, token }); }

module.exports = { createNotification, listNotifications, markRead, registerDevice, removeDevice, preferenceForType, notificationAllowed };
