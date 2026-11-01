const { env } = require('../../config/env');
const { logger } = require('../../common/observability/logger');
const { User } = require('../users/user.model');
const { Business } = require('../businesses/business.model');
const { queueEmail } = require('./email.service');

async function sendUserEmail({ userId, templateKey, data = {}, idempotencyKey, metadata = {} }) {
  if (!env.emailEnabled || !userId) return { queued: false, reason: env.emailEnabled ? 'NO_USER' : 'EMAIL_DISABLED' };
  try {
    const user = await User.findById(userId).select('email firstName lastName').lean();
    if (!user?.email) return { queued: false, reason: 'NO_EMAIL' };
    return await queueEmail({ userId, toEmail: user.email, toName: `${user.firstName} ${user.lastName}`.trim(), templateKey, data: { firstName: user.firstName, ...data }, idempotencyKey, metadata });
  } catch (error) {
    logger.error('email.event.queue_failed', { userId: userId.toString(), templateKey, error: { name: error.name, code: error.code, message: error.message } });
    return { queued: false, reason: 'QUEUE_FAILED' };
  }
}

async function sendBusinessOwnerEmail({ businessId, templateKey, data = {}, idempotencyKey, metadata = {} }) {
  if (!env.emailEnabled || !businessId) return { queued: false, reason: 'EMAIL_DISABLED' };
  try {
    const business = await Business.findById(businessId).select('ownerId name').lean();
    if (!business?.ownerId) return { queued: false, reason: 'NO_BUSINESS_OWNER' };
    return await sendUserEmail({ userId: business.ownerId, templateKey, data: { businessName: business.name, ...data }, idempotencyKey, metadata: { businessId: businessId.toString(), ...metadata } });
  } catch (error) {
    logger.error('email.event.business_owner_lookup_failed', { businessId: businessId.toString(), templateKey, error: { name: error.name, code: error.code, message: error.message } });
    return { queued: false, reason: 'QUEUE_FAILED' };
  }
}

async function sendOrderEmail(order, templateKey, suffix = templateKey, data = {}) {
  return sendUserEmail({
    userId: order.customerId,
    templateKey,
    data: { orderNumber: order.orderNumber, amount: order.totalMinor, currency: order.currency, ...data },
    idempotencyKey: `order-email:${order._id}:${suffix}`,
    metadata: { orderId: order._id.toString(), orderNumber: order.orderNumber }
  });
}

async function sendBookingEmail(booking, templateKey, suffix = templateKey, data = {}) {
  return sendUserEmail({
    userId: booking.customerId,
    templateKey,
    data: { bookingNumber: booking.bookingNumber, serviceName: booking.serviceSnapshot?.serviceName, startAt: booking.startAt, timezone: booking.timezone, ...data },
    idempotencyKey: `booking-email:${booking._id}:${suffix}`,
    metadata: { bookingId: booking._id.toString(), bookingNumber: booking.bookingNumber }
  });
}

module.exports = { sendUserEmail, sendBusinessOwnerEmail, sendOrderEmail, sendBookingEmail };
