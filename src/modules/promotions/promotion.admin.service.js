const { AppError } = require('../../common/errors/AppError');
const { Promotion } = require('./promotion.model');
const { CouponCode } = require('./coupon-code.model');

async function listAdminDiscounts({ search, status, businessId, page = 1, limit = 25 }) {
  const filter = { ...(status ? { status } : {}), ...(businessId ? { businessId } : {}) };
  if (search) { const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ name: new RegExp(escaped, 'i') }, { code: new RegExp(escaped, 'i') }]; }
  const skip = (page - 1) * limit;
  const [discounts, total] = await Promise.all([Promotion.find(filter).populate('businessId', 'name slug').sort({ createdAt: -1 }).skip(skip).limit(limit), Promotion.countDocuments(filter)]);
  return { discounts: discounts.map((discount) => ({ ...discount.toSafeJSON(), business: discount.businessId?.name ? { id: discount.businessId._id.toString(), name: discount.businessId.name, slug: discount.businessId.slug } : null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function disableAdminDiscount(discountId, actorId, reason) {
  const discount = await Promotion.findById(discountId);
  if (!discount) throw new AppError(404, 'DISCOUNT_NOT_FOUND', 'Discount not found');
  if (discount.status !== 'archived') { discount.status = 'archived'; await discount.save(); }
  await CouponCode.updateMany({ promotionId: discount._id, active: true }, { $set: { active: false, disabledAt: new Date(), disabledBy: actorId } });
  return { discount, reason };
}

module.exports = { listAdminDiscounts, disableAdminDiscount };
