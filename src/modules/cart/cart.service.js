const { AppError } = require('../../common/errors/AppError');
const { Cart } = require('./cart.model');
const { Product } = require('../products/product.model');
const { CouponCode } = require('../promotions/coupon-code.model');
const { Promotion } = require('../promotions/promotion.model');
const notificationService = require('../notifications/notification.service');

async function getOrCreateCart(userId) {
  return Cart.findOneAndUpdate({ userId }, { $setOnInsert: { userId, items: [] } }, { upsert: true, new: true });
}

async function getCartView(userId) {
  const cart = await getOrCreateCart(userId);
  const products = await Product.find({ _id: { $in: cart.items.map((item) => item.productId) } }).populate('businessId', 'name slug');
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const items = cart.items.map((item) => {
    const product = productMap.get(item.productId.toString());
    if (!product) return { productId: item.productId.toString(), variantId: item.variantId?.toString() || null, quantity: item.quantity, available: false, reason: 'Product unavailable' };
    const variant = item.variantId ? product.variants.find((candidate) => candidate.variantId.toString() === item.variantId.toString()) : null;
    const target = variant || product;
    const available = product.status === 'active' && product.moderationStatus === 'approved' && (!item.variantId || variant?.active) && (!target.inventoryTracking || target.availableQuantity >= item.quantity);
    return { productId: product._id.toString(), variantId: variant?.variantId?.toString() || null, quantity: item.quantity, available, product: product.toCardJSON(), variant: variant ? { id: variant.variantId.toString(), name: variant.name, priceMinor: variant.priceMinor, availableQuantity: variant.availableQuantity } : null, business: product.businessId ? { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } : null };
  });
  return { id: cart._id.toString(), items, itemCount: items.reduce((sum, item) => sum + item.quantity, 0), appliedCouponCode: cart.appliedCouponCode || null, updatedAt: cart.updatedAt };
}

function sameLine(item, input) {
  return item.productId.toString() === input.productId && (item.variantId?.toString() || null) === (input.variantId || null);
}

async function validateProductLine(input) {
  const product = await Product.findOne({ _id: input.productId, status: 'active', moderationStatus: 'approved' });
  if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'This product is no longer available');
  if (input.variantId) {
    const variant = product.variants.find((candidate) => candidate.variantId.toString() === input.variantId);
    if (!variant || !variant.active) throw new AppError(409, 'PRODUCT_VARIANT_UNAVAILABLE', 'This product variant is no longer available');
  } else if (product.variants.length > 0) {
    throw new AppError(409, 'PRODUCT_VARIANT_REQUIRED', 'Choose a product variant before adding this item');
  }
  return product;
}

async function addItem(userId, input) {
  await validateProductLine(input);
  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((item) => sameLine(item, input));
  if (existing) existing.quantity = Math.min(99, existing.quantity + input.quantity);
  else cart.items.push(input);
  cart.abandonedReminderSentAt = null;
  await cart.save();
  return getCartView(userId);
}

async function updateItem(userId, input) {
  await validateProductLine(input);
  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find((item) => sameLine(item, input));
  if (!existing) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'Cart item not found');
  existing.quantity = input.quantity;
  cart.abandonedReminderSentAt = null;
  await cart.save();
  return getCartView(userId);
}

async function removeItem(userId, input) {
  const cart = await getOrCreateCart(userId);
  cart.items = cart.items.filter((item) => !sameLine(item, input));
  cart.abandonedReminderSentAt = null;
  await cart.save();
  return getCartView(userId);
}

async function clearCart(userId) {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  cart.abandonedReminderSentAt = null;
  await cart.save();
}

async function applyCoupon(userId, code) {
  const cart = await getOrCreateCart(userId);
  const products = await Product.find({ _id: { $in: cart.items.map((item) => item.productId) } }).select('businessId');
  const businessIds = products.map((product) => product.businessId);
  const normalized = code.trim().toUpperCase();
  const coupon = await CouponCode.findOne({ code: normalized, businessId: { $in: businessIds }, active: true });
  const legacy = coupon ? null : await Promotion.findOne({ code: normalized, businessId: { $in: businessIds }, status: 'active', startsAt: { $lte: new Date() }, endsAt: { $gt: new Date() } });
  if (!coupon && !legacy) throw new AppError(400, 'COUPON_INVALID', 'This coupon is invalid or no longer active');
  cart.appliedCouponCode = normalized;
  await cart.save();
  return getCartView(userId);
}

async function removeCoupon(userId) { const cart = await getOrCreateCart(userId); cart.appliedCouponCode = null; await cart.save(); return getCartView(userId); }

async function processAbandonedCartReminders(now = new Date()) {
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60_000);
  const carts = await Cart.find({ 'items.0': { $exists: true }, updatedAt: { $lte: staleBefore }, abandonedReminderSentAt: null }).select('_id userId items updatedAt').limit(500);
  let sent = 0;
  for (const cart of carts) {
    const notification = await notificationService.createNotification({
      userId: cart.userId,
      type: 'cart_reminder',
      title: 'Your cart is waiting',
      body: `You have ${cart.items.length} item${cart.items.length === 1 ? '' : 's'} waiting in your SCOVRR cart.`,
      data: { cartId: cart._id.toString(), itemCount: cart.items.length },
      deduplicationKey: `cart-reminder:${cart._id}:${cart.updatedAt?.toISOString() || 'unknown'}`
    });
    if (notification) sent += 1;
    await Cart.updateOne({ _id: cart._id, updatedAt: cart.updatedAt, abandonedReminderSentAt: null }, { $set: { abandonedReminderSentAt: new Date(now) } });
  }
  return { scanned: carts.length, sent };
}

module.exports = { getOrCreateCart, getCartView, addItem, updateItem, removeItem, clearCart, applyCoupon, removeCoupon, processAbandonedCartReminders, validateProductLine, sameLine };
