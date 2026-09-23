const { AppError } = require('../../common/errors/AppError');
const { Promotion } = require('./promotion.model');
const { CouponCode } = require('./coupon-code.model');
const entitlementService = require('../subscriptions/entitlement.service');
const { PromotionRedemption } = require('./promotion-redemption.model');
const { PromotionCustomerUsage } = require('./promotion-customer-usage.model');

const ACTIVE_STATUSES = ['active'];
const REDEMPTION_ACTIVE_STATUSES = ['reserved', 'consumed', 'redeemed'];
function normalizeCode(code) { return code ? String(code).trim().toUpperCase() : null; }
function normalizedDiscountType(input) { if (input.discountType) return input.discountType === 'fixed' ? 'fixed_amount' : input.discountType; if (input.valueType === 'fixed') return 'fixed_amount'; return input.valueType || 'percentage'; }
function normalizedValueType(input) { const type = normalizedDiscountType(input); return type === 'fixed_amount' ? 'fixed_amount' : type; }
function nowFilter(now = new Date()) { return { status: { $in: ACTIVE_STATUSES }, startsAt: { $lte: now }, endsAt: { $gt: now } }; }
function idEquals(a, b) { return a && b && a.toString() === b.toString(); }
function promotionType(promotion) { return promotion.discountType || (promotion.valueType === 'fixed' ? 'fixed_amount' : promotion.valueType); }

function appliesToPromotion(promotion, line, context = {}) {
  const type = line.type || (context.kind === 'booking' ? 'service' : 'product');
  if (promotion.locationIds?.length && (!context.locationId || !promotion.locationIds.some((id) => idEquals(id, context.locationId)))) return false;
  if (type === 'product' && promotion.excludedProductIds?.some((id) => idEquals(id, line.productId))) return false;
  if (type === 'service' && promotion.excludedServiceIds?.some((id) => idEquals(id, line.serviceId))) return false;
  if (promotion.targetType === 'delivery') return false;
  if (promotion.targetType === 'booking' && context.kind !== 'booking') return false;
  if (promotion.targetType === 'order' && context.kind === 'booking') return false;
  if (['business', 'order', 'booking'].includes(promotion.targetType)) return idEquals(line.businessId, promotion.businessId);
  if (promotion.targetType === 'product') return type === 'product' && promotion.productIds.some((id) => idEquals(id, line.productId));
  if (promotion.targetType === 'product_variant') return type === 'product' && promotion.productVariantIds.some((id) => idEquals(id, line.variantId));
  if (promotion.targetType === 'category') return Boolean(line.categoryId && promotion.categoryIds.some((id) => idEquals(id, line.categoryId)));
  if (promotion.targetType === 'service') return type === 'service' && promotion.serviceIds.some((id) => idEquals(id, line.serviceId));
  if (promotion.targetType === 'service_variant') return type === 'service' && promotion.serviceVariantIds.some((id) => idEquals(id, line.variantId));
  return false;
}

function calculateValue(promotion, eligibleMinor) {
  const type = promotionType(promotion);
  if (type === 'free_delivery') return 0;
  let amount = type === 'percentage' ? Math.floor(eligibleMinor * Number(promotion.value) / 100) : Number(promotion.value);
  if (promotion.maxDiscountMinor !== null && promotion.maxDiscountMinor !== undefined) amount = Math.min(amount, promotion.maxDiscountMinor);
  return Math.max(0, Math.min(amount, eligibleMinor));
}

async function customerUsageCount(promotionId, customerId) {
  const usage = await PromotionCustomerUsage.findOne({ promotionId, customerId }).lean();
  return usage ? usage.usageCount + usage.reservedCount : PromotionRedemption.countDocuments({ promotionId, customerId, status: { $in: REDEMPTION_ACTIVE_STATUSES } });
}

async function assertEligibility(promotion, { customerId, kind = 'order', subtotalMinor, currency, lines, locationId, isCoupon = false }) {
  if (promotion.currency && promotion.currency !== currency) throw new AppError(400, 'DISCOUNT_CURRENCY_MISMATCH', 'This discount is not available in the checkout currency');
  if (promotion.fundedBy === 'platform') throw new AppError(409, 'PLATFORM_DISCOUNT_UNAVAILABLE', 'This platform-funded discount is not currently available');
  if (promotion.minimumSubtotalMinor > subtotalMinor) throw new AppError(400, 'DISCOUNT_MINIMUM_NOT_MET', `Spend at least ${promotion.minimumSubtotalMinor} minor units to use this discount`);
  if (promotion.usageLimit !== null && promotion.usageLimit !== undefined && promotion.usageCount + promotion.reservedCount >= promotion.usageLimit) throw new AppError(409, 'DISCOUNT_LIMIT_REACHED', 'This discount has reached its usage limit');
  if (promotion.perUserLimit && customerId && await customerUsageCount(promotion._id, customerId) >= promotion.perUserLimit) throw new AppError(409, 'DISCOUNT_CUSTOMER_LIMIT_REACHED', 'You have already used this discount the maximum number of times');
  if ((promotion.firstPurchaseOnly || promotion.newCustomerOnly) && customerId && kind === 'order') {
    const { Order } = require('../orders/order.model');
    if (await Order.countDocuments({ customerId, paymentStatus: 'successful', status: { $nin: ['cancelled'] } })) throw new AppError(400, 'DISCOUNT_NEW_CUSTOMER_ONLY', 'This discount is only available on a first purchase');
  }
  if ((promotion.firstBookingOnly || (promotion.newCustomerOnly && kind === 'booking')) && customerId) {
    const { Booking } = require('../bookings/booking.model');
    if (await Booking.countDocuments({ customerId, paymentStatus: 'successful', status: { $nin: ['cancelled_by_customer', 'cancelled_by_business', 'rejected'] } })) throw new AppError(400, 'DISCOUNT_FIRST_BOOKING_ONLY', 'This discount is only available on a first booking');
  }
  if (promotion.minimumOrderCount !== null && promotion.minimumOrderCount !== undefined && customerId) {
    const { Order } = require('../orders/order.model');
    if (await Order.countDocuments({ customerId, paymentStatus: 'successful', status: { $nin: ['cancelled'] } }) < promotion.minimumOrderCount) throw new AppError(400, 'DISCOUNT_ORDER_COUNT_NOT_MET', 'This discount is not available for this customer yet');
  }
  if (promotion.locationIds?.length && (!locationId || !promotion.locationIds.some((id) => idEquals(id, locationId)))) throw new AppError(400, 'DISCOUNT_LOCATION_NOT_ELIGIBLE', 'This discount is not available at the selected location');
  if (!isCoupon && promotion.kind === 'coupon') return;
  const eligibleMinor = lines.filter((line) => appliesToPromotion(promotion, line, { kind, locationId })).reduce((sum, line) => sum + line.lineTotalMinor, 0);
  if (promotionType(promotion) !== 'free_delivery' && eligibleMinor < 1) throw new AppError(400, 'DISCOUNT_NOT_APPLICABLE', 'This discount does not apply to the selected items');
  return eligibleMinor;
}

async function findCouponPromotion(code, businessId, now = new Date()) {
  const normalized = normalizeCode(code);
  const coupon = await CouponCode.findOne({ code: normalized, businessId, active: true });
  if (coupon) {
    const promotion = await Promotion.findOne({ _id: coupon.promotionId, businessId, ...nowFilter(now) });
    if (!promotion) throw new AppError(400, 'COUPON_INVALID', 'This coupon is invalid or no longer active');
    return { promotion, coupon };
  }
  const legacy = await Promotion.findOne({ businessId, code: normalized, ...nowFilter(now) });
  if (!legacy) throw new AppError(400, 'COUPON_INVALID', 'This coupon is invalid or no longer active');
  return { promotion: legacy, coupon: null };
}

async function evaluateCandidate(promotion, context) {
  const eligibleMinor = await assertEligibility(promotion, context);
  const type = promotionType(promotion);
  return { promotion, eligibleMinor, discountMinor: type === 'free_delivery' ? 0 : calculateValue(promotion, eligibleMinor), isDelivery: type === 'free_delivery' };
}
function ordered(candidates) { return candidates.sort((a, b) => (b.promotion.priority || 0) - (a.promotion.priority || 0) || b.discountMinor - a.discountMinor || a.promotion.createdAt - b.promotion.createdAt); }

async function calculatePricing({ businessId, customerId = null, code = null, currency, subtotalMinor, lines, kind = 'order', locationId = null, deliveryFeeMinor = 0, deliveryMethod = null }) {
  const baseContext = { customerId, kind, subtotalMinor, currency, lines, locationId };
  const automatic = await Promotion.find({ businessId, kind: { $ne: 'coupon' }, ...nowFilter() }).sort({ priority: -1, createdAt: 1 });
  const automaticCandidates = [];
  for (const promotion of automatic) {
    try { automaticCandidates.push(await evaluateCandidate(promotion, baseContext)); } catch (error) {
      if (error.code && ['DISCOUNT_MINIMUM_NOT_MET', 'DISCOUNT_NOT_APPLICABLE', 'DISCOUNT_LOCATION_NOT_ELIGIBLE', 'DISCOUNT_NEW_CUSTOMER_ONLY', 'DISCOUNT_FIRST_BOOKING_ONLY', 'DISCOUNT_ORDER_COUNT_NOT_MET', 'DISCOUNT_CUSTOMER_LIMIT_REACHED', 'DISCOUNT_LIMIT_REACHED'].includes(error.code)) continue;
      throw error;
    }
  }
  let couponResult = null;
  if (code) { const resolved = await findCouponPromotion(code, businessId); couponResult = await evaluateCandidate(resolved.promotion, { ...baseContext, isCoupon: true }); couponResult.coupon = resolved.coupon; }
  const automaticMerchandise = ordered(automaticCandidates.filter((item) => !item.isDelivery));
  const selected = [];
  if (couponResult && couponResult.isDelivery) selected.push(couponResult);
  else if (couponResult) {
    if (couponResult.promotion.stackable && automaticMerchandise.length && automaticMerchandise[0].promotion.stackable) selected.push(automaticMerchandise[0], couponResult);
    else selected.push(couponResult);
  } else if (automaticMerchandise.length) selected.push(...(automaticMerchandise[0].promotion.stackable ? automaticMerchandise : [automaticMerchandise[0]]));
  const deliveryCandidates = automaticCandidates.filter((item) => item.isDelivery);
  if (!couponResult?.isDelivery && deliveryCandidates.length) selected.push(ordered(deliveryCandidates)[0]);
  const remainingLines = lines.map((line) => ({ ...line }));
  const allocations = [];
  let discountMinor = 0;
  for (const candidate of selected.filter((item) => !item.isDelivery)) {
    const eligibleLines = remainingLines.filter((line) => appliesToPromotion(candidate.promotion, line, { kind, locationId }));
    const eligibleMinor = eligibleLines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    const amount = calculateValue(candidate.promotion, eligibleMinor);
    if (amount <= 0) continue;
    discountMinor += amount;
    allocations.push({ promotionId: candidate.promotion._id, couponCodeId: candidate.coupon?._id || null, code: candidate.coupon?.code || candidate.promotion.code || null, name: candidate.promotion.name, discountMinor: amount, fundedBy: candidate.promotion.fundedBy, scope: candidate.promotion.targetType, lineIds: eligibleLines.map((line) => line.productId?.toString() || line.serviceId?.toString()) });
    let left = amount;
    for (const line of eligibleLines) { const applied = Math.min(line.lineTotalMinor, left); line.lineTotalMinor -= applied; left -= applied; if (left <= 0) break; }
  }
  const deliveryCandidate = selected.find((item) => item.isDelivery);
  const deliveryEligible = Boolean(deliveryCandidate && ['seller_delivery', 'third_party'].includes(deliveryMethod) && deliveryFeeMinor > 0);
  const deliveryDiscountMinor = deliveryEligible ? deliveryFeeMinor : 0;
  if (deliveryCandidate && !deliveryEligible && deliveryMethod && deliveryMethod !== 'customer_pickup') throw new AppError(400, 'FREE_DELIVERY_UNAVAILABLE', 'Free delivery is not available for this delivery method or location');
  if (deliveryCandidate && deliveryMethod === 'customer_pickup') throw new AppError(400, 'FREE_DELIVERY_UNAVAILABLE', 'Free delivery cannot be applied to pickup');
  const redemptionPlans = allocations.map((allocation) => ({ promotionId: allocation.promotionId, couponCodeId: allocation.couponCodeId, discountMinor: allocation.discountMinor }));
  if (deliveryCandidate && deliveryEligible) redemptionPlans.push({ promotionId: deliveryCandidate.promotion._id, couponCodeId: deliveryCandidate.coupon?._id || null, discountMinor: deliveryDiscountMinor });
  const firstApplied = selected.find((item) => !item.isDelivery);
  return { currency, subtotalMinor, discountMinor, deliveryDiscountMinor, deliveryPromotion: deliveryCandidate?.promotion || null, allocations, redemptionPlans, promotion: couponResult?.promotion || firstApplied?.promotion || deliveryCandidate?.promotion || null, promotions: selected.map((item) => item.promotion), totalBeforeDeliveryMinor: Math.max(0, subtotalMinor - discountMinor), deliveryFeeBeforeDiscountMinor: deliveryFeeMinor, deliveryFeeAfterDiscountMinor: Math.max(0, deliveryFeeMinor - deliveryDiscountMinor), totalMinor: Math.max(0, subtotalMinor - discountMinor) + Math.max(0, deliveryFeeMinor - deliveryDiscountMinor), evaluatedAt: new Date() };
}

async function calculateOrderDiscount({ businessId, code, currency, subtotalMinor, lines, customerId = null }) { const result = await calculatePricing({ businessId, customerId, code, currency, subtotalMinor, lines, kind: 'order' }); return { discountMinor: result.discountMinor, promotion: result.promotion, pricing: result }; }

async function reserveCounter(promotion, customerId) {
  const global = promotion.usageLimit === null || promotion.usageLimit === undefined ? promotion : await Promotion.findOneAndUpdate({ _id: promotion._id, status: 'active', $expr: { $lt: [{ $add: ['$usageCount', '$reservedCount'] }, '$usageLimit'] } }, { $inc: { reservedCount: 1 } }, { new: true });
  if (!global) throw new AppError(409, 'DISCOUNT_LIMIT_REACHED', 'This discount is no longer available');
  if (promotion.usageLimit === null || promotion.usageLimit === undefined) await Promotion.updateOne({ _id: promotion._id }, { $inc: { reservedCount: 1 } });
  if (promotion.perUserLimit && customerId) {
    try {
      let usage;
      try { usage = await PromotionCustomerUsage.findOneAndUpdate({ promotionId: promotion._id, customerId }, { $setOnInsert: { promotionId: promotion._id, customerId }, $set: { updatedAt: new Date() } }, { upsert: true, new: true }); } catch (error) { if (error.code !== 11000) throw error; usage = await PromotionCustomerUsage.findOne({ promotionId: promotion._id, customerId }); }
      const claimed = await PromotionCustomerUsage.findOneAndUpdate({ _id: usage._id, $expr: { $lt: [{ $add: ['$usageCount', '$reservedCount'] }, promotion.perUserLimit] } }, { $inc: { reservedCount: 1 }, $set: { updatedAt: new Date() } }, { new: true });
      if (!claimed) throw new AppError(409, 'DISCOUNT_CUSTOMER_LIMIT_REACHED', 'You have reached this discount limit');
    } catch (error) {
      await Promotion.updateOne({ _id: promotion._id, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } });
      throw error;
    }
  }
}
async function rollbackCounter(promotionId, customerId) { await Promotion.updateOne({ _id: promotionId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 } }); if (customerId) await PromotionCustomerUsage.updateOne({ promotionId, customerId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1 }, $set: { updatedAt: new Date() } }); }

async function reservePromotion({ promotionId, orderId = null, bookingId = null, customerId, couponCodeId = null, discountMinor = 0, idempotencyKey = null }) {
  if (idempotencyKey) { const existing = await PromotionRedemption.findOne({ idempotencyKey }); if (existing) return existing; }
  const promotion = await Promotion.findOne({ _id: promotionId, status: 'active' });
  if (!promotion) throw new AppError(409, 'DISCOUNT_UNAVAILABLE', 'This discount is no longer active');
  await reserveCounter(promotion, customerId);
  try { return await PromotionRedemption.create({ promotionId, orderId, bookingId, customerId, couponCodeId, discountMinor, idempotencyKey: idempotencyKey || `reservation:${promotionId}:${orderId || bookingId}:${customerId}` }); } catch (error) { await rollbackCounter(promotionId, customerId); if (error.code === 11000 && idempotencyKey) return PromotionRedemption.findOne({ idempotencyKey }); throw error; }
}
async function finalizeRedemption(redemption, finalStatus) {
  const next = await PromotionRedemption.findOneAndUpdate({ _id: redemption._id, status: 'reserved' }, { $set: finalStatus === 'consumed' ? { status: 'consumed', consumedAt: new Date() } : { status: 'released', releasedAt: new Date() } }, { new: true });
  if (!next) return null;
  if (finalStatus === 'consumed') { await Promotion.updateOne({ _id: next.promotionId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1, usageCount: 1 } }); await PromotionCustomerUsage.updateOne({ promotionId: next.promotionId, customerId: next.customerId, reservedCount: { $gt: 0 } }, { $inc: { reservedCount: -1, usageCount: 1 }, $set: { updatedAt: new Date() } }); }
  else await rollbackCounter(next.promotionId, next.customerId);
  return next;
}
async function finalizeForTarget(filter, finalStatus) { const redemptions = await PromotionRedemption.find({ ...filter, status: 'reserved' }); for (const redemption of redemptions) await finalizeRedemption(redemption, finalStatus); return redemptions.length; }
async function consumePromotionForOrder(orderId) { const count = await finalizeForTarget({ orderId }, 'consumed'); if (count) { const order = await require('../orders/order.model').Order.findById(orderId).select('customerId businessIds fulfillmentLocationId currency discountMinor promotionId promotionCode totalMinor'); if (order) { const analytics = require('../analytics/domain-event.service'); await analytics.queue('DISCOUNT_APPLIED', { userId: order.customerId, actorType: 'system', businessId: order.businessIds[0], locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), promotionId: order.promotionId?.toString() || null, amountMinor: order.discountMinor, discountMinor: order.discountMinor, currency: order.currency } }, `order:${order._id}:discount-applied`); if (order.promotionCode) await analytics.queue('COUPON_REDEEMED', { userId: order.customerId, actorType: 'system', businessId: order.businessIds[0], locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), promotionId: order.promotionId?.toString() || null, discountMinor: order.discountMinor, currency: order.currency } }, `order:${order._id}:coupon-redeemed`); } } return count; }
async function releasePromotionForOrder(orderId) { return finalizeForTarget({ orderId }, 'released'); }
async function consumePromotionForBooking(bookingId) { const count = await finalizeForTarget({ bookingId }, 'consumed'); if (count) { const booking = await require('../bookings/booking.model').Booking.findById(bookingId).select('customerId businessId locationId serviceId currency discountMinor couponCode depositMinor'); if (booking) { const analytics = require('../analytics/domain-event.service'); await analytics.queue('DISCOUNT_APPLIED', { userId: booking.customerId, actorType: 'system', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), serviceId: booking.serviceId.toString(), amountMinor: booking.discountMinor, discountMinor: booking.discountMinor, currency: booking.currency } }, `booking:${booking._id}:discount-applied`); if (booking.couponCode) await analytics.queue('COUPON_REDEEMED', { userId: booking.customerId, actorType: 'system', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), discountMinor: booking.discountMinor, currency: booking.currency } }, `booking:${booking._id}:coupon-redeemed`); } } return count; }
async function releasePromotionForBooking(bookingId) { return finalizeForTarget({ bookingId }, 'released'); }
async function releaseExpiredReservations(maxAgeHours = 48) { return finalizeForTarget({ createdAt: { $lt: new Date(Date.now() - maxAgeHours * 60 * 60_000) } }, 'released'); }
async function syncPromotionStatuses() { const now = new Date(); const activated = await Promotion.updateMany({ status: 'scheduled', startsAt: { $lte: now }, endsAt: { $gt: now } }, { $set: { status: 'active' } }); const expired = await Promotion.updateMany({ status: { $in: ['scheduled', 'active', 'paused'] }, endsAt: { $lte: now } }, { $set: { status: 'expired' } }); return { activated: activated.modifiedCount, expired: expired.modifiedCount }; }

function assertTransition(current, next) { const allowed = { draft: ['scheduled', 'active', 'archived'], scheduled: ['active', 'paused', 'archived'], active: ['paused', 'expired', 'archived'], paused: ['active', 'archived'], expired: ['archived'], archived: [] }; if (next && !allowed[current]?.includes(next)) throw new AppError(409, 'DISCOUNT_TRANSITION_NOT_ALLOWED', `A ${current} discount cannot become ${next}`); }
async function createPromotion(businessId, userId, input) {
  await entitlementService.assertFeature(businessId, 'commerce.discounts.enabled');
  if (['scheduled', 'active', 'paused'].includes(input.status || 'draft')) await entitlementService.assertWithinLimit(businessId, 'commerce.discounts.active.max', 1);
  if (input.fundedBy === 'platform') throw new AppError(403, 'PLATFORM_DISCOUNTS_DISABLED', 'Platform-funded discounts require a configured subsidy ledger');
  const targetType = input.targetType || 'business';
  if (targetType === 'product' && !input.productIds?.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Product discounts require at least one product');
  if (targetType === 'product_variant' && !input.productVariantIds?.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Product variant discounts require at least one variant');
  if (targetType === 'category' && !input.categoryIds?.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Category discounts require at least one category');
  if (targetType === 'service' && !input.serviceIds?.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Service discounts require at least one service');
  if (targetType === 'service_variant' && !input.serviceVariantIds?.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Service variant discounts require at least one variant');
  if (input.productIds?.length) { const { Product } = require('../products/product.model'); if (await Product.countDocuments({ _id: { $in: input.productIds }, businessId }) !== input.productIds.length) throw new AppError(400, 'DISCOUNT_PRODUCT_OWNERSHIP_REQUIRED', 'Every selected product must belong to this business'); }
  if (input.serviceIds?.length) { const { Service } = require('../services/service.model'); if (await Service.countDocuments({ _id: { $in: input.serviceIds }, businessId }) !== input.serviceIds.length) throw new AppError(400, 'DISCOUNT_SERVICE_OWNERSHIP_REQUIRED', 'Every selected service must belong to this business'); }
  if (input.locationIds?.length) { const { BusinessLocation } = require('../businesses/business-location.model'); if (await BusinessLocation.countDocuments({ _id: { $in: input.locationIds }, businessId, active: true }) !== input.locationIds.length) throw new AppError(400, 'DISCOUNT_LOCATION_OWNERSHIP_REQUIRED', 'Every selected location must belong to this business'); }
  const discountType = normalizedDiscountType(input); const code = normalizeCode(input.code);
  const promotion = await Promotion.create({ ...input, businessId, ownerId: businessId, createdBy: userId, targetType, code, kind: code ? 'coupon' : (input.kind || 'automatic'), discountType, valueType: normalizedValueType(input), value: discountType === 'free_delivery' ? 1 : input.value, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), status: input.status || 'draft' });
  if (code) { try { await CouponCode.create({ promotionId: promotion._id, businessId, code, source: input.codeSource || 'custom', createdBy: userId }); } catch (error) { await Promotion.deleteOne({ _id: promotion._id }); throw error; } }
  return promotion;
}
async function listBusinessPromotions(businessId, status) { const promotions = await Promotion.find({ businessId, ...(status ? { status } : {}) }).sort({ startsAt: -1, createdAt: -1 }); return Promise.all(promotions.map(async (promotion) => ({ ...promotion.toSafeJSON(), coupons: (await CouponCode.find({ promotionId: promotion._id, active: true })).map((coupon) => coupon.toSafeJSON()) }))); }
async function updatePromotion(businessId, promotionId, input, actorId = null) {
  const promotion = await Promotion.findOne({ _id: promotionId, businessId }); if (!promotion) throw new AppError(404, 'DISCOUNT_NOT_FOUND', 'Discount not found');
  if (['scheduled', 'active', 'paused'].includes(input.status) && !['scheduled', 'active', 'paused'].includes(promotion.status)) await entitlementService.assertWithinLimit(businessId, 'commerce.discounts.active.max', 1);
  const pricingChanged = ['value', 'valueType', 'discountType', 'currency', 'maxDiscountMinor', 'minimumSubtotalMinor', 'targetType', 'productIds', 'productVariantIds', 'categoryIds', 'serviceIds', 'serviceVariantIds', 'locationIds', 'firstPurchaseOnly', 'firstBookingOnly', 'perUserLimit', 'stackable'].some((field) => input[field] !== undefined);
  if (promotion.status === 'active' && pricingChanged && input.status !== 'paused') throw new AppError(409, 'DISCOUNT_ACTIVE_EDIT_REQUIRES_PAUSE', 'Pause an active discount before changing its pricing rules');
  const targetType = input.targetType || promotion.targetType;
  const productIds = input.productIds || promotion.productIds;
  const serviceIds = input.serviceIds || promotion.serviceIds;
  const locationIds = input.locationIds || promotion.locationIds;
  if (targetType === 'product' && !productIds.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Product discounts require at least one product');
  if (targetType === 'product_variant' && !(input.productVariantIds || promotion.productVariantIds).length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Product variant discounts require at least one variant');
  if (targetType === 'category' && !(input.categoryIds || promotion.categoryIds).length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Category discounts require at least one category');
  if (targetType === 'service' && !serviceIds.length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Service discounts require at least one service');
  if (targetType === 'service_variant' && !(input.serviceVariantIds || promotion.serviceVariantIds).length) throw new AppError(400, 'DISCOUNT_TARGET_REQUIRED', 'Service variant discounts require at least one variant');
  if (productIds.length) { const { Product } = require('../products/product.model'); if (await Product.countDocuments({ _id: { $in: productIds }, businessId }) !== productIds.length) throw new AppError(400, 'DISCOUNT_PRODUCT_OWNERSHIP_REQUIRED', 'Every selected product must belong to this business'); }
  if (serviceIds.length) { const { Service } = require('../services/service.model'); if (await Service.countDocuments({ _id: { $in: serviceIds }, businessId }) !== serviceIds.length) throw new AppError(400, 'DISCOUNT_SERVICE_OWNERSHIP_REQUIRED', 'Every selected service must belong to this business'); }
  if (locationIds.length) { const { BusinessLocation } = require('../businesses/business-location.model'); if (await BusinessLocation.countDocuments({ _id: { $in: locationIds }, businessId, active: true }) !== locationIds.length) throw new AppError(400, 'DISCOUNT_LOCATION_OWNERSHIP_REQUIRED', 'Every selected location must belong to this business'); }
  if (promotion.usageCount > 0 || promotion.reservedCount > 0) { if (pricingChanged) throw new AppError(409, 'DISCOUNT_ALREADY_REDEEMED', 'Pricing rules cannot change after this discount has been reserved or redeemed'); if (input.code !== undefined) throw new AppError(409, 'DISCOUNT_CODE_LOCKED', 'A coupon code cannot change after use'); }
  if (input.status) assertTransition(promotion.status, input.status); if (input.fundedBy === 'platform') throw new AppError(403, 'PLATFORM_DISCOUNTS_DISABLED', 'Platform-funded discounts require a configured subsidy ledger');
  for (const field of ['name', 'description', 'targetType', 'productIds', 'productVariantIds', 'categoryIds', 'serviceIds', 'serviceVariantIds', 'locationIds', 'excludedProductIds', 'excludedServiceIds', 'valueType', 'discountType', 'value', 'currency', 'maxDiscountMinor', 'minimumSubtotalMinor', 'usageLimit', 'perUserLimit', 'minimumOrderCount', 'firstPurchaseOnly', 'firstBookingOnly', 'newCustomerOnly', 'stackable', 'priority', 'status', 'sponsored']) if (input[field] !== undefined) promotion[field] = input[field];
  if (input.startsAt !== undefined) promotion.startsAt = new Date(input.startsAt); if (input.endsAt !== undefined) promotion.endsAt = new Date(input.endsAt); if (promotion.endsAt <= promotion.startsAt) throw new AppError(400, 'DISCOUNT_DATES_INVALID', 'End time must be after start time'); if (promotion.valueType === 'percentage' && promotion.value > 100) throw new AppError(400, 'DISCOUNT_VALUE_INVALID', 'Percentage discounts cannot exceed 100'); promotion.discountType = normalizedDiscountType(promotion); if (actorId) promotion.updatedBy = actorId; await promotion.save(); return promotion;
}
async function disableCoupon(businessId, promotionId, code, userId) { const coupon = await CouponCode.findOneAndUpdate({ businessId, promotionId, code: normalizeCode(code), active: true }, { $set: { active: false, disabledAt: new Date(), disabledBy: userId } }, { new: true }); if (!coupon) throw new AppError(404, 'COUPON_NOT_FOUND', 'Coupon code not found'); return coupon; }

module.exports = { createPromotion, listBusinessPromotions, updatePromotion, disableCoupon, calculateOrderDiscount, calculatePricing, appliesToPromotion, reservePromotion, consumePromotionForOrder, releasePromotionForOrder, consumePromotionForBooking, releasePromotionForBooking, releaseExpiredReservations, syncPromotionStatuses, normalizeCode };
