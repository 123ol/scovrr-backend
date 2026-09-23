const { AppError } = require('../../common/errors/AppError');
const { PromotionCampaign } = require('./promotion-campaign.model');
const { PromotionFunding } = require('./promotion-funding.model');
const { Payment } = require('../payments/payment.model');
const { recordAudit } = require('../audit/audit.service');

async function list(query = {}) {
  const page = Number(query.page || 1); const limit = Math.min(Number(query.limit || 25), 100);
  const filter = { ...(query.status ? { status: String(query.status).toUpperCase() } : {}), ...(query.targetType ? { targetType: String(query.targetType).toUpperCase() } : {}) };
  if (query.businessId) filter.businessId = query.businessId;
  const [campaigns, total] = await Promise.all([PromotionCampaign.find(filter).populate('businessId', 'name slug').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), PromotionCampaign.countDocuments(filter)]);
  return { campaigns: campaigns.map((campaign) => ({ ...campaign.toSafeJSON(), business: campaign.businessId?.name ? { id: campaign.businessId._id.toString(), name: campaign.businessId.name, slug: campaign.businessId.slug } : null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function get(campaignId) {
  const campaign = await PromotionCampaign.findById(campaignId).populate('businessId', 'name slug status');
  if (!campaign) throw new AppError(404, 'PROMOTION_NOT_FOUND', 'Promotion campaign not found');
  const funding = await PromotionFunding.find({ campaignId }).sort({ createdAt: -1 });
  const payment = funding[0]?.paymentId ? await Payment.findById(funding[0].paymentId) : null;
  return { campaign: campaign.toSafeJSON(), business: campaign.businessId?.name ? { id: campaign.businessId._id.toString(), name: campaign.businessId.name, slug: campaign.businessId.slug, status: campaign.businessId.status } : null, funding: funding.map((item) => item.toSafeJSON()), payment: payment?.toSafeJSON() || null };
}

async function moderate(campaignId, adminId, input) {
  const campaign = await PromotionCampaign.findById(campaignId);
  if (!campaign) throw new AppError(404, 'PROMOTION_NOT_FOUND', 'Promotion campaign not found');
  const before = campaign.toSafeJSON();
  campaign.moderationStatus = input.status;
  campaign.moderationReason = input.reason || null;
  if (input.status === 'rejected' || input.status === 'removed') campaign.status = 'REJECTED';
  else if (input.status === 'approved' && campaign.status === 'REJECTED') campaign.status = campaign.startAt <= new Date() ? 'ACTIVE' : 'SCHEDULED';
  campaign.updatedBy = adminId; await campaign.save();
  await recordAudit({ actorId: adminId, action: input.status === 'approved' ? 'PROMOTION_APPROVED' : 'PROMOTION_MODERATED', targetType: 'promotion_campaign', targetId: campaign._id, businessId: campaign.businessId, reason: input.reason, before, after: campaign.toSafeJSON() });
  return campaign;
}

module.exports = { list, get, moderate };
