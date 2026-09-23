const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { Business } = require('../businesses/business.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Category } = require('../categories/category.model');
const entitlementService = require('../subscriptions/entitlement.service');
const { ENTITLEMENTS } = require('../subscriptions/entitlement-registry');
const { PromotionCampaign } = require('./promotion-campaign.model');
const { PromotionFunding } = require('./promotion-funding.model');
const { PLACEMENTS, TARGET_TYPES, isPlacementAllowed } = require('./promotion-placement');

function campaignNumber() { return `SCV-AD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

function objectId(value, code = 'INVALID_PROMOTION_TARGET') {
  if (!mongoose.isValidObjectId(value)) throw new AppError(400, code, 'The identifier is invalid');
  return new mongoose.Types.ObjectId(value);
}

function normalizeTargetType(value) { return String(value || '').toUpperCase(); }

async function resolveTarget(businessId, targetType, targetId) {
  const id = objectId(targetId, 'INVALID_PROMOTION_TARGET');
  if (targetType === 'BUSINESS') {
    const business = await Business.findOne({ _id: businessId }).select('status moderationStatus capabilities categories');
    if (!business) throw new AppError(404, 'PROMOTION_TARGET_NOT_FOUND', 'The business target was not found');
    return { target: business, categoryIds: business.categories || [] };
  }
  const Model = targetType === 'PRODUCT' ? Product : targetType === 'SERVICE' ? Service : null;
  if (!Model) throw new AppError(400, 'INVALID_PROMOTION_TARGET_TYPE', 'The promotion target type is not supported');
  const target = await Model.findOne({ _id: id, businessId });
  if (!target) throw new AppError(404, 'PROMOTION_TARGET_NOT_FOUND', 'The promotion target was not found in this business');
  return { target, categoryIds: target.categoryId ? [target.categoryId] : [] };
}

async function validateTargeting(businessId, targeting = {}) {
  const locationIds = (targeting.locationIds || []).map((id) => objectId(id, 'INVALID_PROMOTION_LOCATION'));
  if (locationIds.length > 0) {
    const count = await BusinessLocation.countDocuments({ _id: { $in: locationIds }, businessId, active: true });
    if (count !== locationIds.length) throw new AppError(400, 'INVALID_PROMOTION_LOCATION', 'Every selected promotion location must belong to this business and be active');
  }
  const categoryIds = (targeting.categoryIds || []).map((id) => objectId(id, 'INVALID_PROMOTION_CATEGORY'));
  if (categoryIds.length > 0) {
    const count = await Category.countDocuments({ _id: { $in: categoryIds }, enabled: true });
    if (count !== categoryIds.length) throw new AppError(400, 'INVALID_PROMOTION_CATEGORY', 'Every selected promotion category must be enabled');
  }
  if (targeting.radiusKm && !targeting.city && !targeting.locationIds?.length) throw new AppError(400, 'PROMOTION_RADIUS_REQUIRES_LOCATION', 'A radius target requires a city or selected business location');
  return { ...targeting, locationIds, categoryIds };
}

function validatePlacements(targetType, placements) {
  const unique = [...new Set((placements || []).map((value) => String(value).toUpperCase()))];
  if (unique.length === 0 || unique.some((placement) => !PLACEMENTS.includes(placement) || !isPlacementAllowed(targetType, placement))) throw new AppError(400, 'INVALID_PROMOTION_PLACEMENT', 'One or more placements are not available for this target');
  return unique;
}

function validateBudget(input) {
  const budgetMinor = Number(input.budgetMinor);
  if (!Number.isSafeInteger(budgetMinor) || budgetMinor < 100) throw new AppError(400, 'INVALID_PROMOTION_BUDGET', 'Promotion budget must be at least 100 minor currency units');
  const dailyBudgetMinor = input.dailyBudgetMinor === null || input.dailyBudgetMinor === undefined ? null : Number(input.dailyBudgetMinor);
  if (dailyBudgetMinor !== null && (!Number.isSafeInteger(dailyBudgetMinor) || dailyBudgetMinor < 100 || dailyBudgetMinor > budgetMinor)) throw new AppError(400, 'INVALID_PROMOTION_DAILY_BUDGET', 'Daily budget must be at least 100 and no greater than the total budget');
  return { budgetMinor, dailyBudgetMinor };
}

async function assertCreateEntitlements(businessId) {
  await entitlementService.assertFeature(businessId, ENTITLEMENTS.PROMOTIONS_ENABLED);
  await entitlementService.assertWithinLimit(businessId, ENTITLEMENTS.ACTIVE_PROMOTIONS_MAX, 1);
}

async function assertMonthlySpendEntitlement(businessId, amountMinor) {
  await entitlementService.assertWithinLimit(businessId, ENTITLEMENTS.MONTHLY_PROMOTION_SPEND_MAX, amountMinor);
}

async function createDraft(businessId, userId, input) {
  const business = await Business.findById(businessId);
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  if (business.status === 'suspended') throw new AppError(409, 'BUSINESS_SUSPENDED', 'A suspended business cannot create promotions');
  await assertCreateEntitlements(businessId);
  const targetType = normalizeTargetType(input.targetType);
  if (!TARGET_TYPES.includes(targetType)) throw new AppError(400, 'INVALID_PROMOTION_TARGET_TYPE', 'The promotion target type is not supported');
  const { target } = await resolveTarget(businessId, targetType, input.targetId || businessId);
  const { budgetMinor, dailyBudgetMinor } = validateBudget(input);
  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) throw new AppError(400, 'INVALID_PROMOTION_SCHEDULE', 'Promotion end time must be after its start time');
  const currency = String(input.currency || 'NGN').toUpperCase();
  await assertMonthlySpendEntitlement(businessId, budgetMinor);
  const campaign = await PromotionCampaign.create({
    campaignNumber: campaignNumber(), businessId, targetType, targetId: target._id, name: input.name,
    objective: input.objective || 'awareness', status: 'DRAFT', startAt, endAt, timezone: input.timezone || 'Africa/Lagos',
    currency, budgetMinor, dailyBudgetMinor, targeting: await validateTargeting(businessId, input.targeting),
    placements: validatePlacements(targetType, input.placements), createdBy: userId, updatedBy: userId
  });
  return campaign;
}

async function getBusinessCampaign(businessId, campaignId) {
  const campaign = await PromotionCampaign.findOne({ _id: objectId(campaignId), businessId });
  if (!campaign) throw new AppError(404, 'PROMOTION_NOT_FOUND', 'Promotion campaign not found');
  return campaign;
}

async function updateDraft(businessId, campaignId, userId, input) {
  const campaign = await getBusinessCampaign(businessId, campaignId);
  if (!['DRAFT', 'PENDING_PAYMENT'].includes(campaign.status)) throw new AppError(409, 'PROMOTION_NOT_EDITABLE', 'Only an unfunded promotion can be edited');
  if (campaign.status === 'PENDING_PAYMENT') throw new AppError(409, 'PROMOTION_PAYMENT_PENDING', 'Wait for the current payment attempt to finish before editing this promotion');
  const changes = { updatedBy: userId };
  if (input.name !== undefined) changes.name = input.name;
  if (input.objective !== undefined) changes.objective = input.objective;
  if (input.startAt !== undefined) changes.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) changes.endAt = new Date(input.endAt);
  if (input.timezone !== undefined) changes.timezone = input.timezone;
  if (input.targeting !== undefined) changes.targeting = await validateTargeting(businessId, input.targeting);
  if (input.placements !== undefined) changes.placements = validatePlacements(campaign.targetType, input.placements);
  if (input.budgetMinor !== undefined || input.dailyBudgetMinor !== undefined) Object.assign(changes, validateBudget({ budgetMinor: input.budgetMinor ?? campaign.budgetMinor, dailyBudgetMinor: input.dailyBudgetMinor ?? campaign.dailyBudgetMinor }));
  const nextStart = changes.startAt || campaign.startAt; const nextEnd = changes.endAt || campaign.endAt;
  if (nextEnd <= nextStart) throw new AppError(400, 'INVALID_PROMOTION_SCHEDULE', 'Promotion end time must be after its start time');
  if (changes.budgetMinor) await assertMonthlySpendEntitlement(businessId, changes.budgetMinor);
  Object.assign(campaign, changes); await campaign.save(); return campaign;
}

async function listBusinessCampaigns(businessId, query = {}) {
  const page = Number(query.page || 1); const limit = Math.min(Number(query.limit || 20), 100);
  const filter = { businessId, ...(query.status ? { status: String(query.status).toUpperCase() } : {}) };
  const [campaigns, total] = await Promise.all([PromotionCampaign.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), PromotionCampaign.countDocuments(filter)]);
  return { campaigns: campaigns.map((campaign) => campaign.toSafeJSON()), total, page, limit, pages: Math.ceil(total / limit) };
}

async function transition(businessId, campaignId, userId, nextStatus) {
  const campaign = await getBusinessCampaign(businessId, campaignId);
  const allowed = { PAUSED: ['ACTIVE', 'SCHEDULED'], ACTIVE: ['PAUSED', 'SCHEDULED'], CANCELLED: ['DRAFT', 'PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'PAUSED'] };
  if (!allowed[nextStatus]?.includes(campaign.status)) throw new AppError(409, 'PROMOTION_INVALID_TRANSITION', `A promotion cannot move from ${campaign.status} to ${nextStatus}`);
  if (nextStatus === 'ACTIVE' && campaign.remainingMinor() < 1) throw new AppError(409, 'PROMOTION_BUDGET_EXHAUSTED', 'This promotion has no remaining funded budget');
  campaign.status = nextStatus; campaign.updatedBy = userId;
  if (nextStatus === 'CANCELLED') campaign.cancelledAt = new Date();
  await campaign.save(); return campaign;
}

async function transitionAdmin(campaignId, userId, nextStatus) {
  const campaign = await PromotionCampaign.findById(campaignId);
  if (!campaign) throw new AppError(404, 'PROMOTION_NOT_FOUND', 'Promotion campaign not found');
  const allowed = { PAUSED: ['ACTIVE', 'SCHEDULED'], CANCELLED: ['DRAFT', 'PENDING_PAYMENT', 'SCHEDULED', 'ACTIVE', 'PAUSED'] };
  if (!allowed[nextStatus]?.includes(campaign.status)) throw new AppError(409, 'PROMOTION_INVALID_TRANSITION', `A promotion cannot move from ${campaign.status} to ${nextStatus}`);
  campaign.status = nextStatus; campaign.updatedBy = userId; if (nextStatus === 'CANCELLED') campaign.cancelledAt = new Date(); await campaign.save(); return campaign;
}

async function activateFromFundingPayment(payment) {
  const funding = await PromotionFunding.findOne({ _id: payment.promotionFundingId, campaignId: payment.campaignId, status: { $in: ['pending', 'verified'] } });
  if (!funding) throw new AppError(409, 'PROMOTION_FUNDING_CONTEXT_INVALID', 'The promotion funding context is invalid');
  if (funding.status === 'verified') return PromotionCampaign.findById(funding.campaignId);
  const campaign = await PromotionCampaign.findOneAndUpdate({ _id: funding.campaignId, businessId: payment.businessId, status: { $in: ['DRAFT', 'PENDING_PAYMENT'] }, currency: payment.currency, budgetMinor: funding.amountMinor }, { $set: { status: 'SCHEDULED', fundedAt: new Date(), updatedBy: payment.customerId }, $inc: { fundedMinor: funding.amountMinor } }, { new: true });
  if (!campaign) throw new AppError(409, 'PROMOTION_FUNDING_STATE_INVALID', 'The promotion cannot be funded in its current state');
  campaign.status = campaign.startAt <= new Date() ? 'ACTIVE' : 'SCHEDULED';
  await campaign.save();
  funding.status = 'verified'; funding.verifiedAt = new Date(); await funding.save();
  return campaign;
}

async function initializeFunding(businessId, userId, campaignId, input = {}) {
  const campaign = await getBusinessCampaign(businessId, campaignId);
  if (campaign.status !== 'DRAFT') throw new AppError(409, 'PROMOTION_NOT_READY_FOR_FUNDING', 'Only a draft promotion can be funded');
  await assertMonthlySpendEntitlement(businessId, campaign.budgetMinor);
  const idempotencyKey = input.idempotencyKey || `promotion-funding:${campaign._id}:${campaign.budgetMinor}`;
  let funding = await PromotionFunding.findOne({ idempotencyKey });
  if (funding?.paymentId) return { campaign, funding, payment: await require('../payments/payment.model').Payment.findById(funding.paymentId) };
  if (!funding) funding = await PromotionFunding.create({ campaignId: campaign._id, businessId, idempotencyKey, amountMinor: campaign.budgetMinor, currency: campaign.currency });
  campaign.status = 'PENDING_PAYMENT'; campaign.updatedBy = userId; await campaign.save();
  try {
    const payment = await require('../payments/payment.service').initializePromotionPayment(userId, campaign, funding, input);
    return { campaign, funding: await PromotionFunding.findById(funding._id), payment };
  } catch (error) {
    campaign.status = 'DRAFT'; await campaign.save(); funding.status = 'failed'; funding.failureReason = error.message; await funding.save(); throw error;
  }
}

async function consumeBudget(campaignId, amountMinor) {
  const dateKey = new Date().toISOString().slice(0, 10);
  const campaign = await PromotionCampaign.findOneAndUpdate({ _id: campaignId, status: 'ACTIVE', $expr: { $and: [{ $gte: [{ $subtract: [{ $subtract: ['$fundedMinor', '$spentMinor'] }, { $add: ['$reservedMinor', '$refundedMinor'] }] }, amountMinor] }, { $or: [{ $eq: ['$dailyBudgetMinor', null] }, { $ne: ['$currentDailyDateKey', dateKey] }, { $lte: [{ $add: ['$currentDailySpendMinor', amountMinor] }, '$dailyBudgetMinor'] }] }] } }, [{ $set: { spentMinor: { $add: ['$spentMinor', amountMinor] }, currentDailyDateKey: dateKey, currentDailySpendMinor: { $cond: [{ $eq: ['$currentDailyDateKey', dateKey] }, { $add: ['$currentDailySpendMinor', amountMinor] }, amountMinor] } } }], { new: true });
  if (campaign) return campaign;
  const current = await PromotionCampaign.findById(campaignId);
  if (current && ['ACTIVE', 'SCHEDULED'].includes(current.status) && current.remainingMinor() < 1) await PromotionCampaign.updateOne({ _id: campaignId, status: { $in: ['ACTIVE', 'SCHEDULED'] } }, { $set: { status: 'EXHAUSTED', completedAt: new Date() } });
  return null;
}

async function completeExpiredCampaigns(now = new Date()) {
  const result = await PromotionCampaign.updateMany({ status: { $in: ['SCHEDULED', 'ACTIVE', 'PAUSED'] }, endAt: { $lte: now } }, { $set: { status: 'COMPLETED', completedAt: now } });
  return result.modifiedCount || 0;
}

async function activateScheduledCampaigns(now = new Date()) {
  const result = await PromotionCampaign.updateMany({ status: 'SCHEDULED', startAt: { $lte: now }, endAt: { $gt: now }, $expr: { $gt: [{ $subtract: [{ $subtract: ['$fundedMinor', '$spentMinor'] }, { $add: ['$reservedMinor', '$refundedMinor'] }] }, 0] } }, { $set: { status: 'ACTIVE' } });
  return result.modifiedCount || 0;
}

async function getMetrics(businessId, campaignId, query = {}) {
  const campaign = await getBusinessCampaign(businessId, campaignId);
  const { PromotionDailyAggregate } = require('./promotion-daily-aggregate.model');
  const page = Number(query.page || 1); const limit = Math.min(Number(query.limit || 31), 100);
  const [rows, total] = await Promise.all([PromotionDailyAggregate.find({ campaignId: campaign._id }).sort({ dateKey: -1 }).skip((page - 1) * limit).limit(limit), PromotionDailyAggregate.countDocuments({ campaignId: campaign._id })]);
  return { campaign: campaign.toSafeJSON(), metrics: rows, total, page, limit, pages: Math.ceil(total / limit) };
}

module.exports = { campaignNumber, createDraft, updateDraft, getBusinessCampaign, listBusinessCampaigns, transition, transitionAdmin, activateFromFundingPayment, initializeFunding, consumeBudget, completeExpiredCampaigns, activateScheduledCampaigns, getMetrics, resolveTarget, validateTargeting, validatePlacements, assertMonthlySpendEntitlement };
