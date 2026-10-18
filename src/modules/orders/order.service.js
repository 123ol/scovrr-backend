const crypto = require('node:crypto');
const { AppError } = require('../../common/errors/AppError');
const { Cart } = require('../cart/cart.model');
const { Address } = require('../addresses/address.model');
const { Product } = require('../products/product.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Order } = require('./order.model');
const { InventoryReservation } = require('../inventory/inventory-reservation.model');
const inventoryService = require('../inventory/inventory.service');
const cartService = require('../cart/cart.service');
const { env } = require('../../config/env');
const promotionService = require('../promotions/promotion.service');
const { assertUserCanActById } = require('../users/user-status.service');
const deliveryService = require('../deliveries/delivery.service');
const { Delivery } = require('../deliveries/delivery.model');
const { membershipHasPermission } = require('../../middleware/business-access');

function orderNumber() {
  return `SCV-ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function addressSnapshot(address) {
  if (!address) return null;
  const snapshot = address.toObject();
  delete snapshot._id;
  delete snapshot.userId;
  delete snapshot.createdAt;
  delete snapshot.updatedAt;
  return snapshot;
}

async function buildCheckoutData(userId, input) {
  const cart = await Cart.findOne({ userId });
  if (!cart || cart.items.length === 0) throw new AppError(400, 'CART_EMPTY', 'Add an item to your cart before checking out');
  const address = input.fulfillmentMethod === 'delivery'
    ? await Address.findOne({ _id: input.addressId, userId })
    : null;
  if (input.fulfillmentMethod === 'delivery' && !address) throw new AppError(400, 'DELIVERY_ADDRESS_REQUIRED', 'Choose a saved delivery address before checking out');

  await inventoryService.releaseExpiredReservations();
  const products = await Product.find({ _id: { $in: cart.items.map((item) => item.productId) }, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const lines = [];
  const businessIds = new Set();
  let currency = null;
  for (const item of cart.items) {
    const product = productMap.get(item.productId.toString());
    if (!product || !product.businessId || product.businessId.status !== 'active' || product.businessId.moderationStatus !== 'approved') throw new AppError(409, 'CART_ITEM_UNAVAILABLE', 'One or more cart items are no longer available');
    const variant = item.variantId ? product.variants.find((candidate) => candidate.variantId.toString() === item.variantId.toString()) : null;
    if (product.variants.length > 0 && (!variant || !variant.active)) throw new AppError(409, 'CART_VARIANT_UNAVAILABLE', `The selected variant for ${product.name} is unavailable`);
    const target = variant || product;
    if (target.inventoryTracking && target.availableQuantity < item.quantity) throw new AppError(409, 'CART_STOCK_CHANGED', `${product.name} no longer has enough stock`);
    if (currency && currency !== product.currency) throw new AppError(409, 'MULTI_CURRENCY_CART', 'All items in one checkout must use the same currency');
    currency = product.currency;
    businessIds.add(product.businessId._id.toString());
    const snapshot = product.toSnapshot(variant?.variantId || null, item.quantity);
    lines.push({ ...snapshot, type: 'product', categoryId: product.categoryId || null, businessName: product.businessId.name, lineTotalMinor: snapshot.unitPriceMinor * item.quantity });
  }
  if (businessIds.size > 1) throw new AppError(409, 'MULTI_SELLER_CHECKOUT_NOT_ENABLED', 'Multi-seller checkout is not enabled yet; checkout one business at a time');
  const businessId = [...businessIds][0];
  const location = input.fulfillmentLocationId
    ? await BusinessLocation.findOne({ _id: input.fulfillmentLocationId, businessId, active: true })
    : await BusinessLocation.findOne({ businessId, active: true }).sort({ primary: -1, createdAt: 1 });
  if (!location) throw new AppError(409, 'FULFILLMENT_LOCATION_REQUIRED', 'Choose an active branch for this checkout');
  const deliveryMethod = input.fulfillmentMethod === 'pickup' ? 'customer_pickup' : (input.deliveryMethod || 'seller_delivery');
  if (deliveryMethod === 'customer_pickup' && input.fulfillmentMethod !== 'pickup') throw new AppError(400, 'INVALID_DELIVERY_METHOD', 'Customer pickup requires pickup fulfillment');
  if (input.fulfillmentMethod === 'pickup' && !location.pickupAvailable) throw new AppError(409, 'PICKUP_UNAVAILABLE', 'Pickup is not available at the selected branch');
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const couponCode = input.couponCode || cart.appliedCouponCode || null;
  const merchandisePricing = await promotionService.calculatePricing({ businessId, customerId: userId, code: couponCode, currency, subtotalMinor, lines, kind: 'order' });
  const deliveryQuote = await deliveryService.quote({ locationId: location._id, businessId, method: deliveryMethod, subtotalMinor: merchandisePricing.totalBeforeDeliveryMinor, currency, destinationAddress: address });
  const pricing = await promotionService.calculatePricing({ businessId, customerId: userId, code: couponCode, currency, subtotalMinor, lines, kind: 'order', locationId: location._id, deliveryFeeMinor: deliveryQuote.feeMinor, deliveryMethod });
  return { cart, address, location, deliveryMethod, deliveryQuote, lines, currency, businessIds: [...businessIds], subtotalMinor, discountMinor: pricing.discountMinor, deliveryDiscountMinor: pricing.deliveryDiscountMinor, promotion: pricing.promotion, pricing, deliveryMinor: pricing.deliveryFeeAfterDiscountMinor, totalMinor: pricing.totalMinor, couponCode };
}

async function previewCheckout(userId, input) {
  const data = await buildCheckoutData(userId, input);
  return {
    currency: data.currency,
    lines: data.lines,
    subtotalMinor: data.subtotalMinor,
    discountMinor: data.discountMinor,
    deliveryDiscountMinor: data.deliveryDiscountMinor,
    promotion: data.promotion?.toSafeJSON() || null,
    pricing: data.pricing,
    deliveryMinor: data.deliveryMinor,
    totalMinor: data.totalMinor,
    fulfillmentMethod: input.fulfillmentMethod,
    deliveryMethod: data.deliveryMethod,
    fulfillmentLocationId: data.location._id.toString(),
    delivery: data.deliveryQuote,
    shippingAddress: addressSnapshot(data.address),
    paymentAvailable: Boolean(env.paystackSecretKey),
    paymentMessage: env.paystackSecretKey ? 'Review the total, then continue to secure payment.' : 'Payment provider configuration is required before a charge can be initialized.'
  };
}

async function createPendingOrder(userId, input) {
  await assertUserCanActById(userId);
  if (input.idempotencyKey) {
    const existing = await Order.findOne({ customerId: userId, checkoutIdempotencyKey: input.idempotencyKey });
    if (existing) return existing;
  }
  const data = await buildCheckoutData(userId, input);
  const reservationIds = [];
  let createdOrder = null;
  try {
    for (const line of data.lines) {
      const product = await Product.findById(line.productId);
      const target = line.variantId ? product.variants.find((variant) => variant.variantId.toString() === line.variantId.toString()) : product;
      if (target?.inventoryTracking) {
        const reservation = await inventoryService.reserveStock({ productId: line.productId, businessId: line.businessId, locationId: data.location._id, variantId: line.variantId, userId, quantity: line.quantity });
        reservationIds.push(reservation._id);
      }
    }

    const order = await Order.create({
      orderNumber: orderNumber(),
      customerId: userId,
      ...(input.idempotencyKey ? { checkoutIdempotencyKey: input.idempotencyKey } : {}),
      businessIds: data.businessIds,
      items: data.lines.map(({ lineTotalMinor: _lineTotalMinor, businessName: _businessName, ...snapshot }) => snapshot),
      currency: data.currency,
      subtotalMinor: data.subtotalMinor,
      discountMinor: data.discountMinor,
      deliveryDiscountMinor: data.deliveryDiscountMinor,
      promotionId: data.promotion?._id || null,
      promotionCode: data.couponCode || data.promotion?.code || null,
      pricingSnapshot: data.pricing,
      deliveryMinor: data.deliveryMinor,
      totalMinor: data.totalMinor,
      paymentStatus: 'not_initialized',
      fulfillmentStatus: 'pending',
      status: 'pending_payment',
      fulfillmentMethod: input.fulfillmentMethod,
      deliveryMethod: data.deliveryMethod,
      fulfillmentLocationId: data.location._id,
      deliverySnapshot: { method: data.deliveryMethod, provider: data.deliveryQuote.provider, feeMinor: data.deliveryQuote.feeMinor, currency: data.currency, locationId: data.location._id, locationName: data.location.name, pickupAddress: data.location.address, destinationAddress: addressSnapshot(data.address), estimatedDeliveryMinutes: data.deliveryQuote.estimatedDeliveryMinutes },
      shippingAddressSnapshot: addressSnapshot(data.address),
      reservationIds,
      timeline: [{ status: 'pending_payment', actorId: userId, note: 'Checkout prepared; payment must be initialized and verified before fulfillment.' }]
    });
    createdOrder = order;
    await InventoryReservation.updateMany({ _id: { $in: reservationIds } }, { $set: { orderId: order._id } });
    const delivery = await deliveryService.createForOrder(order, { method: data.deliveryMethod, location: data.location, feeMinor: data.deliveryMinor, currency: data.currency });
    order.deliveryId = delivery.delivery._id;
    order.deliverySnapshot = delivery.delivery.toSafeJSON();
    order._pickupCode = delivery.pickupCode;
    await order.save();
    for (const plan of data.pricing.redemptionPlans || []) await promotionService.reservePromotion({ promotionId: plan.promotionId, couponCodeId: plan.couponCodeId, discountMinor: plan.discountMinor, orderId: order._id, customerId: userId, idempotencyKey: `order:${order._id}:promotion:${plan.promotionId}` });
    await cartService.clearCart(userId);
    await require('../analytics/domain-event.service').queue('ORDER_CREATED', { userId, actorType: 'user', businessId: data.businessIds[0], locationId: data.location._id, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), amountMinor: order.totalMinor, currency: order.currency, discountMinor: order.discountMinor } }, `order:${order._id}:created`);
    return order;
  } catch (error) {
    for (const reservationId of reservationIds) await inventoryService.releaseReservation(reservationId, userId, 'Checkout preparation failed');
    if (input.idempotencyKey && error?.code === 11000 && error.keyPattern?.checkoutIdempotencyKey) {
      const existing = await Order.findOne({ customerId: userId, checkoutIdempotencyKey: input.idempotencyKey });
      if (existing) return existing;
    }
    if (createdOrder) {
      await promotionService.releasePromotionForOrder(createdOrder._id);
      createdOrder.status = 'cancelled';
      createdOrder.fulfillmentStatus = 'cancelled';
      createdOrder.cancellation = { reason: 'Checkout preparation failed', cancelledBy: userId, cancelledAt: new Date() };
      await createdOrder.save();
    }
    throw error;
  }
}

async function listOrders(userId) {
  const orders = await Order.find({ customerId: userId }).sort({ createdAt: -1 }).limit(100);
  return orders.map((order) => order.toSafeJSON());
}

async function reorder(userId, orderId) {
  const order = await getOrder(userId, orderId);
  const added = [];
  const skipped = [];
  for (const item of order.items) {
    try {
      await cartService.addItem(userId, { productId: item.productId.toString(), variantId: item.variantId?.toString() || null, quantity: Math.min(99, item.quantity) });
      added.push({ productId: item.productId.toString(), productName: item.productName, quantity: Math.min(99, item.quantity) });
    } catch (error) {
      skipped.push({ productId: item.productId.toString(), productName: item.productName, code: error.code || 'PRODUCT_UNAVAILABLE', reason: error.message });
    }
  }
  if (!added.length) throw new AppError(409, 'REORDER_UNAVAILABLE', 'None of the products in this order are currently available', { skipped });
  return { cart: await cartService.getCartView(userId), added, skipped };
}

async function getOrder(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, customerId: userId });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  return order;
}

async function cancelPendingOrder(userId, orderId) {
  const order = await getOrder(userId, orderId);
  if (order.status !== 'pending_payment') throw new AppError(409, 'ORDER_CANCELLATION_NOT_AVAILABLE', 'Only unpaid pending orders can be cancelled at this stage');
  await inventoryService.releaseOrderReservations(order._id, userId, 'Customer cancelled pending checkout');
  await promotionService.releasePromotionForOrder(order._id);
  order.status = 'cancelled';
  order.fulfillmentStatus = 'cancelled';
  order.cancellation = { reason: 'Customer cancelled pending checkout', cancelledBy: userId, cancelledAt: new Date() };
  order.timeline.push({ status: 'cancelled', actorId: userId, note: 'Pending checkout cancelled.' });
  await order.save();
  await require('../analytics/domain-event.service').queue('ORDER_CANCELLED', { userId, actorType: 'user', businessId: order.businessIds[0], locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), amountMinor: order.totalMinor, currency: order.currency, reason: order.cancellation.reason } }, `order:${order._id}:cancelled`);
  return order;
}

async function listBusinessOrders(businessId, query, membership) {
  const allowedLocations = membership.locationAccess?.mode === 'selected' ? (membership.locationAccess.locationIds || []) : null;
  const filter = { businessIds: businessId };
  if (query.status) filter.status = query.status;
  if (query.locationId) {
    if (allowedLocations && !allowedLocations.some((id) => id.toString() === query.locationId.toString())) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'You do not have access to this branch');
    filter.fulfillmentLocationId = query.locationId;
  } else if (allowedLocations) filter.fulfillmentLocationId = { $in: allowedLocations };
  const skip = (query.page - 1) * query.limit;
  const [orders, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Order.countDocuments(filter)]);
  const deliveries = await Delivery.find({ businessId, orderId: { $in: orders.map((order) => order._id) } });
  const deliveryByOrder = new Map(deliveries.map((delivery) => [delivery.orderId.toString(), delivery.toSafeJSON()]));
  return { orders: orders.map((order) => ({ ...order.toSafeJSON(), delivery: deliveryByOrder.get(order._id.toString()) || order.deliverySnapshot })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getBusinessOrder(businessId, orderId, membership) {
  const order = await Order.findOne({ _id: orderId, businessIds: businessId });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (membership.locationAccess?.mode === 'selected' && (!order.fulfillmentLocationId || !membership.locationAccess.locationIds.some((id) => id.toString() === order.fulfillmentLocationId.toString()))) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  return order;
}

async function transitionBusinessOrder({ businessId, orderId, actorId, action, membership, reason }) {
  const requiredPermission = { accept: 'orders.accept', process: 'orders.fulfill', ready: 'orders.fulfill', cancel: 'orders.cancel' }[action];
  if (!membershipHasPermission(membership, requiredPermission)) throw new AppError(403, 'BUSINESS_PERMISSION_REQUIRED', 'You do not have permission for this order action');
  const order = await getBusinessOrder(businessId, orderId, membership);
  const transitions = {
    accept: { from: ['paid'], to: 'confirmed' },
    process: { from: ['confirmed'], to: 'processing' },
    ready: { from: ['processing'], to: order.fulfillmentMethod === 'pickup' ? 'ready_for_pickup' : 'ready_for_delivery' },
    cancel: { from: ['paid', 'confirmed', 'processing'], to: 'cancelled' }
  };
  const rule = transitions[action];
  if (!rule || !rule.from.includes(order.status)) throw new AppError(409, 'ORDER_TRANSITION_NOT_ALLOWED', 'This order cannot make that transition');
  order.status = rule.to; order.fulfillmentStatus = rule.to; order.timeline.push({ status: rule.to, actorId, note: reason || `Business ${action}ed order.` });
  await order.save();
  if (action === 'cancel') await inventoryService.releaseOrderReservations(order._id, actorId, reason || 'Business cancelled order');
  if (action === 'cancel') await require('../analytics/domain-event.service').queue('ORDER_CANCELLED', { actorId, actorType: 'user', businessId, locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), amountMinor: order.totalMinor, currency: order.currency, reason: reason || 'Business cancelled order' } }, `order:${order._id}:cancelled`);
  return order;
}

module.exports = { previewCheckout, createPendingOrder, listOrders, getOrder, reorder, cancelPendingOrder, listBusinessOrders, getBusinessOrder, transitionBusinessOrder, buildCheckoutData, addressSnapshot, orderNumber };
