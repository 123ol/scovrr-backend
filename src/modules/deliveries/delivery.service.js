const crypto = require('node:crypto');
const { AppError } = require('../../common/errors/AppError');
const { Delivery } = require('./delivery.model');
const { Order } = require('../orders/order.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const notificationService = require('../notifications/notification.service');
const { logger } = require('../../common/observability/logger');
const { attachEvidence } = require('../evidence/evidence.service');

function deliveryNumber() { return `SCV-DLV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function pickupCode() { return String(crypto.randomInt(100000, 1000000)); }
function hashCode(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
function normalizedPlace(value) { return String(value || '').trim().toLocaleLowerCase(); }
function buildProofSnapshot(proof = {}, evidence = [], recordedBy = null, recordedAt = new Date()) {
  const proofDetails = Object.fromEntries(Object.entries(proof || {}).filter(([key]) => key !== 'evidenceAssetIds'));
  return { ...proofDetails, ...(evidence.length ? { evidence } : {}), recordedBy, recordedAt };
}
function isAddressInDeliveryZones(address, zones = []) {
  if (!zones.length) return true;
  const state = normalizedPlace(address?.state); const city = normalizedPlace(address?.city);
  return Boolean(state) && zones.some((zone) => normalizedPlace(zone.state) === state && (!zone.cities?.length || zone.cities.some((item) => normalizedPlace(item) === city)));
}
async function quote({ locationId, businessId, method, subtotalMinor, currency, destinationAddress = null }) {
  if (method === 'customer_pickup') return { method, provider: 'customer_pickup', feeMinor: 0, currency, estimatedDeliveryMinutes: 0 };
  if (method === 'third_party') throw new AppError(503, 'DELIVERY_PROVIDER_NOT_CONFIGURED', 'A third-party delivery provider is not configured');
  const location = await BusinessLocation.findOne({ _id: locationId, businessId, active: true }).select('delivery');
  if (!location || !location.delivery?.enabled) throw new AppError(409, 'SELLER_DELIVERY_UNAVAILABLE', 'Seller delivery is not available from this branch');
  if (!isAddressInDeliveryZones(destinationAddress, location.delivery.zones || [])) throw new AppError(409, 'DELIVERY_ZONE_UNAVAILABLE', 'This seller does not deliver to the selected state or city');
  const feeMinor = location.delivery.freeDeliveryThresholdMinor !== null && subtotalMinor >= location.delivery.freeDeliveryThresholdMinor ? 0 : location.delivery.flatFeeMinor;
  return { method: 'seller_delivery', provider: 'manual_seller_delivery', feeMinor, currency, estimatedDeliveryMinutes: location.delivery.estimatedDeliveryMinutes };
}

async function createForOrder(order, { method, location, feeMinor, currency }) {
  if (method === 'third_party') throw new AppError(503, 'DELIVERY_PROVIDER_NOT_CONFIGURED', 'A third-party delivery provider is not configured');
  const code = method === 'customer_pickup' ? pickupCode() : null;
  const delivery = await Delivery.create({ deliveryNumber: deliveryNumber(), orderId: order._id, businessId: order.businessIds[0], locationId: location._id, method, provider: method === 'customer_pickup' ? 'customer_pickup' : 'manual_seller_delivery', pickupAddressSnapshot: { name: location.name, address: location.address, coordinates: location.location || null, contactPhone: location.contactPhone || null, pickupInstructions: location.pickupInstructions || '', pickupPreparationMinutes: location.pickupPreparationMinutes || 0 }, destinationAddressSnapshot: order.shippingAddressSnapshot, feeMinor, currency, status: method === 'customer_pickup' ? 'pending' : 'pending', pickupCodeHash: code ? hashCode(code) : null, estimatedDeliveryAt: method === 'seller_delivery' ? new Date(Date.now() + (location.delivery?.estimatedDeliveryMinutes || 120) * 60_000) : null, timeline: [{ status: 'pending', actorId: order.customerId, note: method === 'customer_pickup' ? 'Pickup order created.' : 'Seller delivery order created.' }] });
  return { delivery, pickupCode: code };
}

async function getCustomerDelivery(userId, orderId) {
  const order = await Order.findOne({ _id: orderId, customerId: userId }).select('_id');
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  const delivery = await Delivery.findOne({ orderId });
  if (!delivery) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery has not been created yet');
  return delivery;
}

async function getBusinessDelivery(businessId, deliveryId, membership = null) {
  const delivery = await Delivery.findOne({ _id: deliveryId, businessId });
  if (!delivery) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
  if (membership?.locationAccess?.mode === 'selected' && !membership.locationAccess.locationIds.some((id) => id.toString() === delivery.locationId.toString())) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
  return delivery;
}

async function transition({ businessId, deliveryId, actorId, action, pickupCodeValue, estimatedPickupAt, courier, proof, membership = null }) {
  const delivery = await Delivery.findOne({ _id: deliveryId, businessId }).select('+pickupCodeHash');
  if (!delivery) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
  if (membership?.locationAccess?.mode === 'selected' && !membership.locationAccess.locationIds.some((id) => id.toString() === delivery.locationId.toString())) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
  const transitions = {
    ready: { methods: ['customer_pickup', 'seller_delivery'], from: ['pending', 'processing'], to: delivery.method === 'customer_pickup' ? 'ready_for_pickup' : 'awaiting_courier' },
    schedule_pickup: { methods: ['customer_pickup'], from: ['pending', 'ready_for_pickup'], to: delivery.status },
    assign: { methods: ['seller_delivery'], from: ['pending', 'awaiting_courier', 'ready_for_delivery', 'failed'], to: delivery.status },
    dispatch: { methods: ['seller_delivery'], from: ['pending', 'ready_for_delivery', 'awaiting_courier'], to: 'in_transit' },
    pickup: { methods: ['customer_pickup'], from: ['pending', 'ready_for_pickup'], to: 'picked_up_by_customer' },
    complete: { methods: ['customer_pickup'], from: ['picked_up_by_customer'], to: 'completed' },
    picked_up: { methods: ['seller_delivery'], from: ['ready_for_delivery', 'awaiting_courier'], to: 'picked_up' },
    delivered: { methods: ['seller_delivery'], from: ['picked_up', 'in_transit', 'delivery_attempted'], to: 'delivered' },
    attempted: { methods: ['seller_delivery'], from: ['in_transit', 'picked_up'], to: 'delivery_attempted' },
    failed: { methods: ['seller_delivery'], from: ['delivery_attempted'], to: 'failed' },
    retry: { methods: ['seller_delivery'], from: ['failed'], to: 'awaiting_courier' }
  };
  const rule = transitions[action];
  if (!rule || !rule.methods.includes(delivery.method) || !rule.from.includes(delivery.status)) throw new AppError(409, 'DELIVERY_TRANSITION_NOT_ALLOWED', 'This delivery cannot make that transition');
  if (action === 'assign' && (!courier || !String(courier.name || '').trim())) throw new AppError(400, 'COURIER_ASSIGNMENT_REQUIRED', 'Courier name is required');
  if (action === 'schedule_pickup') {
    const pickupAt = new Date(estimatedPickupAt || '');
    if (Number.isNaN(pickupAt.getTime()) || pickupAt <= new Date() || pickupAt > new Date(Date.now() + 90 * 24 * 60 * 60_000)) throw new AppError(400, 'INVALID_PICKUP_SCHEDULE', 'Pickup must be scheduled within the next 90 days');
    delivery.estimatedPickupAt = pickupAt;
  }
  if (action === 'pickup') {
    if (!pickupCodeValue || !delivery.pickupCodeHash || delivery.pickupCodeUsedAt || hashCode(pickupCodeValue) !== delivery.pickupCodeHash) throw new AppError(409, 'INVALID_PICKUP_CODE', 'The pickup code is invalid or has already been used');
    delivery.pickupCodeUsedAt = new Date(); delivery.verifiedBy = actorId;
  }
  if (action === 'assign') {
    delivery.courierAssignment = { name: courier.name.trim(), phone: courier.phone?.trim() || '', note: courier.note?.trim() || '', assignedAt: new Date(), assignedBy: actorId };
  }
  delivery.status = rule.to;
  if (rule.to === 'picked_up' || rule.to === 'picked_up_by_customer') delivery.pickedUpAt = new Date();
  if (rule.to === 'delivered' || rule.to === 'completed') delivery.deliveredAt = new Date();
  if (proof !== undefined) {
    const { evidenceAssetIds = [], ...proofDetails } = proof || {};
    let evidence = [];
    if (evidenceAssetIds.length) {
      evidence = await attachEvidence({ userId: actorId, purpose: 'delivery', subject: { id: delivery._id, subjectType: 'delivery', subjectId: delivery._id }, evidenceAssetIds, visibility: 'parties' });
    }
    delivery.proof = buildProofSnapshot(proofDetails, evidence, actorId);
  }
  delivery.timeline.push({ status: delivery.status, actorId, note: action === 'schedule_pickup' ? `Pickup scheduled for ${delivery.estimatedPickupAt.toISOString()}.` : action === 'assign' ? `Courier assigned: ${delivery.courierAssignment.name}.` : `Delivery ${action} completed.` });
  await delivery.save();
  const order = await Order.findById(delivery.orderId);
  if (order) {
    const orderStatus = delivery.status === 'ready_for_pickup' ? 'ready_for_pickup' : delivery.status === 'awaiting_courier' || delivery.status === 'failed' ? 'ready_for_delivery' : delivery.status === 'in_transit' ? 'out_for_delivery' : delivery.status === 'completed' ? 'completed' : delivery.status === 'delivered' || delivery.status === 'picked_up_by_customer' ? 'delivered' : null;
    if (orderStatus && order.status !== orderStatus) {
      order.status = orderStatus; order.fulfillmentStatus = orderStatus; order.timeline.push({ status: orderStatus, actorId, note: `Fulfillment updated from delivery ${delivery.deliveryNumber}.` }); await order.save();
      const eventName = orderStatus === 'delivered' ? 'ORDER_DELIVERED' : orderStatus === 'completed' ? 'ORDER_COMPLETED' : null;
      if (eventName) await require('../analytics/domain-event.service').queue(eventName, { actorId, actorType: 'user', userId: order.customerId, businessId: order.businessIds[0], locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), amountMinor: order.totalMinor, currency: order.currency, status: orderStatus } }, `order:${order._id}:${eventName.toLowerCase()}`);
    }
    try {
      await notificationService.createNotification({
        userId: order.customerId,
        type: 'delivery_update',
        title: 'Delivery update',
        body: `Order ${order.orderNumber} is now ${delivery.status.replaceAll('_', ' ')}.`,
        data: { orderId: order._id.toString(), deliveryId: delivery._id.toString(), status: delivery.status },
        deduplicationKey: `delivery:${delivery._id}:${delivery.status}`
      });
    } catch (error) {
      logger.warn('delivery.notification.failed', { deliveryId: delivery._id.toString(), error: { name: error.name, code: error.code, message: error.message } });
    }
  }
  return delivery;
}

module.exports = { quote, createForOrder, getCustomerDelivery, getBusinessDelivery, transition, deliveryNumber, pickupCode, hashCode, isAddressInDeliveryZones, buildProofSnapshot };
