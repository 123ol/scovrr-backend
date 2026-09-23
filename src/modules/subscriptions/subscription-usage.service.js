const { BusinessMembership } = require('../businesses/business-membership.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { BusinessInvitation } = require('../staff/business-invitation.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Promotion } = require('../promotions/promotion.model');
const { PromotionCampaign } = require('../advertising/promotion-campaign.model');
const { PromotionFunding } = require('../advertising/promotion-funding.model');

async function getUsage(businessId, now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [staffMemberships, pendingInvitations, locations, products, services, activeDiscounts, activePromotions, monthlyPromotionFunding] = await Promise.all([
    BusinessMembership.countDocuments({ businessId, status: 'active', role: { $ne: 'owner' } }),
    BusinessInvitation.countDocuments({ businessId, status: 'pending', expiresAt: { $gt: now } }),
    BusinessLocation.countDocuments({ businessId, active: true }),
    Product.countDocuments({ businessId, status: { $in: ['draft', 'pending_review', 'active', 'sold_out'] } }),
    Service.countDocuments({ businessId, status: { $in: ['draft', 'pending_review', 'active'] } }),
    Promotion.countDocuments({ businessId, status: { $in: ['scheduled', 'active', 'paused'] } }),
    PromotionCampaign.countDocuments({ businessId, status: { $in: ['scheduled', 'active', 'paused'] } }),
    PromotionFunding.aggregate([{ $match: { businessId, status: { $in: ['pending', 'verified', 'partially_refunded'] }, createdAt: { $gte: monthStart } } }, { $group: { _id: null, total: { $sum: { $subtract: ['$amountMinor', '$refundedMinor'] } } } }])
  ]);

  return {
    'business.staff.max': staffMemberships + pendingInvitations,
    'business.locations.max': locations,
    'commerce.products.max': products,
    'commerce.services.max': services,
    'commerce.discounts.active.max': activeDiscounts,
    'growth.promotions.active.max': activePromotions,
    'growth.promotions.monthlySpend.max': monthlyPromotionFunding[0]?.total || 0
  };
}

module.exports = { getUsage };
