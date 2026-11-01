const mongoose = require('mongoose');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { sanitizeErrorMessage, logger } = require('../../common/observability/logger');
const { enqueueJob } = require('../../jobs/job.service');
const { EmailDelivery } = require('./email-delivery.model');
const { EmailWebhookEvent } = require('./email-webhook-event.model');
const { User } = require('../users/user.model');
const { decryptEmailPayload, encryptEmailPayload } = require('./email.crypto');
const { TEMPLATE_DEFINITIONS, renderEmailTemplate } = require('./email.templates');
const resend = require('../../integrations/email/resend.provider');

const TERMINAL_STATUSES = new Set(['sent', 'delivered', 'bounced', 'complained']);
const ESSENTIAL_CATEGORIES = new Set(['security', 'seller', 'payout']);
const PREFERENCE_BY_CATEGORY = Object.freeze({ order: 'orderUpdates', booking: 'bookingUpdates', marketing: 'marketing', messages: 'messages' });

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

async function emailAllowed(userId, category) {
  if (ESSENTIAL_CATEGORIES.has(category) || !userId || !PREFERENCE_BY_CATEGORY[category]) return true;
  const user = await User.findById(userId).select('notificationPreferences').lean();
  return user?.notificationPreferences?.[PREFERENCE_BY_CATEGORY[category]] !== false;
}

async function queueEmail({ userId = null, toEmail, toName = '', templateKey, data = {}, idempotencyKey, metadata = {} }) {
  if (!env.emailEnabled) return { queued: false, reason: 'EMAIL_DISABLED' };
  if (!toEmail || !templateKey || !idempotencyKey) throw new AppError(400, 'EMAIL_INVALID_REQUEST', 'Email recipient, template, and idempotency key are required');
  const definition = TEMPLATE_DEFINITIONS[templateKey];
  if (!definition) throw new AppError(400, 'EMAIL_TEMPLATE_NOT_FOUND', 'The requested email template does not exist');
  if (!(await emailAllowed(userId, definition.category))) return { queued: false, reason: 'PREFERENCE_DISABLED' };
  const rendered = renderEmailTemplate(templateKey, data);
  let delivery;
  try {
    delivery = await EmailDelivery.create({
      userId,
      toEmail: String(toEmail).trim().toLowerCase(),
      toName,
      templateKey,
      category: rendered.category,
      subject: rendered.subject,
      idempotencyKey,
      encryptedPayload: encryptEmailPayload(data),
      metadata,
      status: 'queued',
      nextAttemptAt: new Date()
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    delivery = await EmailDelivery.findOne({ idempotencyKey });
  }
  if (!delivery) throw new AppError(500, 'EMAIL_QUEUE_FAILED', 'The email could not be queued');
  await enqueueJob({ type: 'email_send', payload: { emailDeliveryId: delivery._id.toString() }, idempotencyKey: `email-send:${delivery.idempotencyKey}` });
  return { queued: true, deliveryId: delivery._id.toString(), status: delivery.status };
}

function senderForCategory(category) {
  const address = category === 'security' ? env.resendSecurityEmail
    : category === 'seller' || category === 'payout' ? env.resendSellerEmail
      : category === 'support' ? env.resendSupportEmail : env.resendFromEmail;
  return address || env.resendFromEmail || 'notifications@scovrr.com';
}

async function sendEmailDelivery(deliveryId) {
  if (!isValidObjectId(deliveryId)) throw new AppError(400, 'EMAIL_DELIVERY_INVALID', 'Invalid email delivery id');
  const delivery = await EmailDelivery.findOneAndUpdate(
    { _id: deliveryId, status: { $nin: [...TERMINAL_STATUSES, 'sending'] } },
    { $set: { status: 'sending', lastError: null, nextAttemptAt: null }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!delivery) return { skipped: true };
  try {
    const data = decryptEmailPayload(delivery.encryptedPayload);
    const rendered = renderEmailTemplate(delivery.templateKey, data);
    const result = await resend.sendEmail({
      from: `${env.resendFromName || 'SCOVRR'} <${senderForCategory(delivery.category)}>`,
      to: [delivery.toEmail],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: delivery.idempotencyKey
    });
    delivery.status = 'sent';
    delivery.providerMessageId = result?.id || result?.email_id || delivery.providerMessageId;
    delivery.sentAt = new Date();
    delivery.lastError = null;
    await delivery.save();
    return { sent: true, deliveryId: delivery._id.toString(), providerMessageId: delivery.providerMessageId };
  } catch (error) {
    delivery.status = 'failed';
    delivery.lastError = sanitizeErrorMessage(error?.message || 'Email delivery failed').slice(0, 1_000);
    delivery.nextAttemptAt = new Date(Date.now() + Math.min(15 * 60 * 1_000, 1_000 * (2 ** Math.max(delivery.attempts - 1, 0))));
    await delivery.save();
    logger.warn('email.delivery.failed', { deliveryId: delivery._id.toString(), templateKey: delivery.templateKey, error: { name: error.name, code: error.code, message: delivery.lastError } });
    throw error;
  }
}

const WEBHOOK_STATUS_MAP = Object.freeze({
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delivery_delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained'
});

async function processResendWebhook(rawBody, headers) {
  const event = await resend.verifyWebhook({ payload: rawBody, headers });
  const type = event?.type || '';
  const providerEventId = event?.id || event?.data?.id;
  const providerMessageId = event?.data?.email_id || event?.data?.emailId || event?.email_id;
  if (!providerEventId || !type) throw new AppError(400, 'EMAIL_WEBHOOK_INVALID', 'Email webhook payload is invalid');
  try {
    await EmailWebhookEvent.create({ providerEventId, type, providerMessageId: providerMessageId || null, processedAt: new Date() });
  } catch (error) {
    if (error?.code === 11000) return { duplicate: true };
    throw error;
  }
  const status = WEBHOOK_STATUS_MAP[type];
  if (!status || !providerMessageId) return { processed: true, updated: false };
  const update = { status, lastWebhookAt: new Date() };
  if (status === 'delivered') update.deliveredAt = new Date();
  await EmailDelivery.findOneAndUpdate({ providerMessageId }, { $set: update });
  return { processed: true, updated: true, status };
}

async function listEmailDeliveries({ page = 1, limit = 50, status, category, templateKey } = {}) {
  const filter = {};
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (templateKey) filter.templateKey = templateKey;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const [items, total] = await Promise.all([
    EmailDelivery.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit),
    EmailDelivery.countDocuments(filter)
  ]);
  return { items: items.map((item) => item.toSafeJSON()), page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) };
}

async function retryEmailDelivery(deliveryId) {
  if (!isValidObjectId(deliveryId)) throw new AppError(400, 'EMAIL_DELIVERY_INVALID', 'Invalid email delivery id');
  const delivery = await EmailDelivery.findOneAndUpdate(
    { _id: deliveryId, status: { $in: ['failed', 'dead'] } },
    { $set: { status: 'queued', nextAttemptAt: new Date(), lastError: null } },
    { new: true }
  );
  if (!delivery) throw new AppError(409, 'EMAIL_NOT_RETRYABLE', 'Only failed email deliveries can be retried');
  await enqueueJob({ type: 'email_send', payload: { emailDeliveryId: delivery._id.toString() }, idempotencyKey: `email-retry:${delivery._id}:${Date.now()}` });
  return delivery.toSafeJSON();
}

module.exports = { queueEmail, sendEmailDelivery, processResendWebhook, listEmailDeliveries, retryEmailDelivery, emailAllowed, ESSENTIAL_CATEGORIES, PREFERENCE_BY_CATEGORY };
