const { PromotionCampaign } = require('./promotion-campaign.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { createPlacementToken } = require('./promotion-event.service');
const { logger } = require('../../common/observability/logger');

function placementFor(query) {
  if (query.q) return 'SEARCH_RESULTS';
  if (query.categoryId) return 'CATEGORY_RESULTS';
  return 'DISCOVER_HOME';
}

function categoryMatches(campaign, query) {
  const ids = campaign.targeting?.categoryIds || [];
  return ids.length === 0 || (query.categoryId && ids.some((id) => id.toString() === query.categoryId.toString()));
}

function locationMatches(campaign, query) {
  const targeting = campaign.targeting || {};
  if (targeting.city && (!query.city || targeting.city.toLowerCase() !== String(query.city).toLowerCase())) return false;
  if (targeting.state && query.state && targeting.state.toLowerCase() !== String(query.state).toLowerCase()) return false;
  return true;
}

async function selectedLocationMatches(campaign, item) {
  const ids = campaign.targeting?.locationIds || [];
  if (!ids.length) return true;
  return Boolean(await BusinessLocation.exists({ _id: { $in: ids }, businessId: item.businessId, active: true, publiclyVisible: true }));
}

async function mixCollection(items, targetType, query, placement, limit = 2) {
  if (!items.length) return items;
  const ids = items.map((item) => item.id).filter(Boolean);
  const campaigns = await PromotionCampaign.find({ targetType, targetId: { $in: ids }, placements: placement, status: 'ACTIVE', moderationStatus: 'approved', startAt: { $lte: new Date() }, endAt: { $gt: new Date() }, $expr: { $gt: [{ $subtract: [{ $subtract: ['$fundedMinor', '$spentMinor'] }, { $add: ['$reservedMinor', '$refundedMinor'] }] }, 0] } }).sort({ createdAt: 1 }).limit(Math.max(limit * 3, 6));
  const campaignByTarget = new Map();
  for (const campaign of campaigns) if (categoryMatches(campaign, query) && locationMatches(campaign, query) && !campaignByTarget.has(campaign.targetId.toString())) campaignByTarget.set(campaign.targetId.toString(), campaign);
  const sponsored = [];
  const organic = [...items];
  for (const item of items) {
    if (sponsored.length >= limit) break;
    const campaign = campaignByTarget.get(item.id);
    if (!campaign || !(await selectedLocationMatches(campaign, item))) continue;
    const index = organic.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) organic.splice(index, 1);
    sponsored.push({ ...item, isSponsored: true, promotion: { isSponsored: true, placement, token: createPlacementToken({ campaignId: campaign._id.toString(), targetType, targetId: item.id, placement }) } });
  }
  return [...sponsored, ...organic];
}

async function safeMix(items, targetType, query, placement) {
  try { return await mixCollection(items, targetType, query, placement); } catch (error) { logger.error('promotion.selection.failed', { error: { name: error.name, code: error.code, message: error.message } }); return items; }
}

async function mixDiscovery(result, query) {
  const placement = placementFor(query);
  const [products, services, businesses] = await Promise.all([
    safeMix(result.products || [], 'PRODUCT', query, placement),
    safeMix(result.services || [], 'SERVICE', query, placement),
    safeMix(result.businesses || [], 'BUSINESS', query, placement)
  ]);
  return { ...result, products, services, businesses };
}

module.exports = { placementFor, mixCollection, mixDiscovery };
