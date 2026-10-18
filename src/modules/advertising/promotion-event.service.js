const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { Business } = require('../businesses/business.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { PromotionCampaign } = require('./promotion-campaign.model');
const { PromotionEvent } = require('./promotion-event.model');
const { PromotionDailyAggregate } = require('./promotion-daily-aggregate.model');
const promotionService = require('./promotion.service');
const analyticsOutbox = require('../analytics/analytics-outbox.service');
const { logger } = require('../../common/observability/logger');

function key() { return crypto.createHash('sha256').update(env.promotionEventSecret || 'scovrr-dev-promotion-secret').digest(); }
function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

function createPlacementToken(data, ttlSeconds = 900) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlSeconds * 1_000 })).toString('base64url');
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function verifyPlacementToken(token) {
  try {
    const [version, ivText, tagText, encryptedText] = String(token).split('.');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw new Error('invalid token');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
    const payload = JSON.parse(Buffer.from(plaintext, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) throw new Error('expired token');
    return payload;
  } catch (_error) { throw new AppError(400, 'INVALID_PROMOTION_EVENT_TOKEN', 'This sponsored placement token is invalid or expired'); }
}

async function targetBusinessId(targetType, targetId) {
  if (targetType === 'BUSINESS') return targetId;
  const target = await (targetType === 'PRODUCT' ? Product.findById(targetId).select('businessId status moderationStatus') : Service.findById(targetId).select('businessId status moderationStatus'));
  if (!target) return null;
  if (target.status !== 'active' || target.moderationStatus !== 'approved') return null;
  return target.businessId;
}

async function assertEligible(payload) {
  const campaign = await PromotionCampaign.findOne({ _id: payload.campaignId, targetType: payload.targetType, targetId: payload.targetId, placements: payload.placement, status: 'ACTIVE', moderationStatus: 'approved', startAt: { $lte: new Date() }, endAt: { $gt: new Date() } });
  if (!campaign || campaign.remainingMinor() < 1) throw new AppError(409, 'PROMOTION_NOT_SERVING', 'This sponsored placement is no longer available');
  const businessId = await targetBusinessId(payload.targetType, payload.targetId);
  const business = businessId ? await Business.findOne({ _id: businessId, status: 'active', moderationStatus: 'approved' }).select('status moderationStatus') : null;
  if (!business || business._id.toString() !== campaign.businessId.toString()) throw new AppError(409, 'PROMOTION_TARGET_UNAVAILABLE', 'This sponsored target is no longer available');
  return campaign;
}

function actorHash(req, sessionKey) {
  const actor = req.auth?.userId || sessionKey || `${req.ip || 'unknown'}:${req.get('user-agent') || 'unknown'}`;
  return hash(actor);
}

async function isSelfInteraction(campaign, req) {
  if (!req.auth?.userId) return false;
  return Boolean(await BusinessMembership.exists({ userId: req.auth.userId, businessId: campaign.businessId, status: 'active' }));
}

async function mirrorToAnalytics(event, campaign = null) {
  const resolvedCampaign = campaign || await PromotionCampaign.findById(event.campaignId).select('businessId currency');
  if (!resolvedCampaign) return;
  const eventName = event.type === 'impression' ? 'PROMOTION_IMPRESSION' : event.type === 'click' ? 'PROMOTION_CLICK' : 'PROMOTION_CONVERSION';
  const entityType = event.targetType === 'PRODUCT' ? 'product' : event.targetType === 'SERVICE' ? 'service' : 'business';
  await analyticsOutbox.enqueueDomainEvent(eventName, { actorType: event.userId ? 'user' : 'anonymous', userId: event.userId || null, businessId: resolvedCampaign.businessId, entityType, entityId: event.targetId, source: 'SPONSORED', placement: event.placement, metadata: { campaignId: event.campaignId, promotionId: event.campaignId, placement: event.placement, currency: resolvedCampaign.currency, amountMinor: event.spendMinor || 0, conversionId: event.conversionId || null }, occurredAt: event.createdAt, anonymousSessionId: event.actorHash || null }, `promotion-event:${event._id}`);
}

async function recordEvent(req, type, input) {
  const payload = verifyPlacementToken(input.token);
  const campaign = await assertEligible(payload);
  if (await isSelfInteraction(campaign, req)) return { accepted: false, selfInteraction: true };
  const actor = actorHash(req, input.sessionKey);
  const windowMs = type === 'impression' ? 10 * 60 * 1_000 : 60 * 60 * 1_000;
  const bucket = Math.floor(Date.now() / windowMs);
  const eventKey = hash(`${campaign._id}:${payload.placement}:${type}:${actor}:${bucket}:${input.conversionId || ''}`);
  let event;
  try {
    event = await PromotionEvent.create({ eventKey, campaignId: campaign._id, targetType: payload.targetType, targetId: payload.targetId, placement: payload.placement, type, status: 'accepted', userId: req.auth?.userId || null, actorHash: actor, tokenHash: hash(input.token), conversionId: input.conversionId || null, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000) });
  } catch (error) {
    if (error?.code === 11000) return { accepted: false, duplicate: true };
    throw error;
  }
  if (type === 'impression') {
    const updated = await promotionService.consumeBudget(campaign._id, env.promotionImpressionCostMinor);
    if (!updated) { event.status = 'rejected'; await event.save(); return { accepted: false, outOfBudget: true }; }
    event.spendMinor = env.promotionImpressionCostMinor; await event.save();
  }
  const dateKey = new Date().toISOString().slice(0, 10);
  const increment = type === 'impression' ? { impressions: 1, spendMinor: event.spendMinor } : type === 'click' ? { clicks: 1 } : { conversions: 1 };
  await PromotionDailyAggregate.findOneAndUpdate({ campaignId: campaign._id, dateKey, placement: payload.placement }, { $inc: increment }, { upsert: true, new: true, setDefaultsOnInsert: true });
  event.aggregated = true; await event.save();
  try { await mirrorToAnalytics(event, campaign); } catch (error) { logger.error('promotion.analytics_event.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
  return { accepted: true, eventId: event._id.toString() };
}

async function recordConversion({ userId, targetType, targetIds, conversionId }) {
  if (!userId || !conversionId || !Array.isArray(targetIds) || targetIds.length === 0) return { accepted: false, reason: 'not_eligible' };
  const since = new Date(Date.now() - env.promotionAttributionWindowDays * 24 * 60 * 60 * 1_000);
  const click = await PromotionEvent.findOne({ userId, type: 'click', status: 'accepted', targetType, targetId: { $in: targetIds }, createdAt: { $gte: since } }).sort({ createdAt: -1 });
  if (!click) return { accepted: false, reason: 'no_eligible_click' };
  const eventKey = hash(`conversion:${click.campaignId}:${conversionId}`);
  let conversionEvent;
  try {
    conversionEvent = await PromotionEvent.create({ eventKey, campaignId: click.campaignId, targetType, targetId: click.targetId, placement: click.placement, type: 'conversion', status: 'accepted', userId, actorHash: click.actorHash, tokenHash: click.tokenHash, conversionId, expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000) });
  } catch (error) {
    if (error?.code === 11000) return { accepted: false, duplicate: true };
    throw error;
  }
  await PromotionDailyAggregate.findOneAndUpdate({ campaignId: click.campaignId, dateKey: new Date().toISOString().slice(0, 10), placement: click.placement }, { $inc: { conversions: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  await PromotionEvent.updateOne({ _id: conversionEvent._id }, { $set: { aggregated: true } });
    try { await mirrorToAnalytics(conversionEvent); } catch (error) { logger.error('promotion.analytics_conversion.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
  return { accepted: true };
}

async function aggregatePendingEvents(limit = 500) {
  const events = await PromotionEvent.find({ status: 'accepted', aggregated: false }).sort({ createdAt: 1 }).limit(limit);
  let processed = 0;
  for (const event of events) {
    const dateKey = event.createdAt.toISOString().slice(0, 10);
    const increment = event.type === 'impression' ? { impressions: 1, spendMinor: event.spendMinor } : event.type === 'click' ? { clicks: 1 } : { conversions: 1 };
    await PromotionDailyAggregate.findOneAndUpdate({ campaignId: event.campaignId, dateKey, placement: event.placement }, { $inc: increment }, { upsert: true, new: true, setDefaultsOnInsert: true });
    try { await mirrorToAnalytics(event); } catch (error) { logger.error('promotion.analytics_event.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
    await PromotionEvent.updateOne({ _id: event._id, aggregated: false }, { $set: { aggregated: true } }); processed += 1;
  }
  return processed;
}

async function recordConversionForOrder(order) {
  const targetIds = (order.items || []).map((item) => item.productId).filter(Boolean);
  return recordConversion({ userId: order.customerId, targetType: 'PRODUCT', targetIds, conversionId: `order:${order._id}` });
}

async function recordConversionForBooking(booking) {
  return recordConversion({ userId: booking.customerId, targetType: 'SERVICE', targetIds: [booking.serviceId].filter(Boolean), conversionId: `booking:${booking._id}` });
}

module.exports = { createPlacementToken, verifyPlacementToken, recordEvent, recordConversionForOrder, recordConversionForBooking, aggregatePendingEvents, hash };
