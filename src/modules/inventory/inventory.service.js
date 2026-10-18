const crypto = require('node:crypto');
const { AppError } = require('../../common/errors/AppError');
const { Product } = require('../products/product.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { InventoryMovement } = require('./inventory-movement.model');
const { InventoryReservation } = require('./inventory-reservation.model');
const { InventoryPosition } = require('./inventory-position.model');
const { StockTransfer } = require('./stock-transfer.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { createNotification } = require('../notifications/notification.service');

function variantKey(variantId) { return variantId ? variantId.toString() : 'base'; }

function targetValues(product, variantId) {
  if (!variantId) return { tracked: product.inventoryTracking, stock: product.stockQuantity, reserved: product.reservedQuantity, available: product.availableQuantity };
  const variant = product.variants.find((item) => item.variantId.toString() === variantId.toString());
  if (!variant) throw new AppError(400, 'PRODUCT_VARIANT_NOT_FOUND', 'The selected product variant does not exist');
  return { tracked: variant.inventoryTracking, stock: variant.stockQuantity, reserved: variant.reservedQuantity, available: variant.availableQuantity, variant };
}

async function assertLocation(businessId, locationId) {
  if (!locationId) return null;
  const location = await BusinessLocation.findOne({ _id: locationId, businessId, active: true });
  if (!location) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'The selected business location is unavailable');
  return location;
}

async function primaryLocation(businessId) {
  const location = await BusinessLocation.findOne({ businessId, active: true }).sort({ primary: -1, createdAt: 1 });
  if (!location) throw new AppError(409, 'BUSINESS_LOCATION_REQUIRED', 'Create an active business location before managing location inventory');
  return location;
}

async function ensurePosition({ businessId, locationId, product, variantId }) {
  const location = await assertLocation(businessId, locationId);
  if (!location) throw new AppError(400, 'BUSINESS_LOCATION_REQUIRED', 'A location is required for this inventory operation');
  const key = variantKey(variantId);
  let position = await InventoryPosition.findOne({ businessId, locationId, productId: product._id, variantKey: key });
  if (position) return position;
  const existingPosition = await InventoryPosition.exists({ businessId, productId: product._id, variantKey: key });
  const current = targetValues(product, variantId);
  try {
    position = await InventoryPosition.create({ businessId, locationId, productId: product._id, variantId: variantId || null, variantKey: key, inventoryTracking: current.tracked, quantityOnHand: existingPosition ? 0 : current.stock, quantityReserved: existingPosition ? 0 : current.reserved, quantityAvailable: existingPosition ? 0 : current.available, lowStockThreshold: current.variant?.lowStockThreshold ?? product.lowStockThreshold });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    position = await InventoryPosition.findOne({ businessId, locationId, productId: product._id, variantKey: key });
  }
  return position;
}

async function refreshAvailability(productId) {
  const product = await Product.findById(productId);
  if (!product) return null;
  const positions = await InventoryPosition.find({ productId }).select('variantId inventoryTracking quantityOnHand quantityReserved quantityAvailable');
  if (positions.length) {
    if (product.variants.length) {
      for (const variant of product.variants) {
        const rows = positions.filter((position) => position.variantId?.toString() === variant.variantId.toString());
        if (rows.length) {
          variant.stockQuantity = rows.reduce((sum, row) => sum + row.quantityOnHand, 0);
          variant.reservedQuantity = rows.reduce((sum, row) => sum + row.quantityReserved, 0);
          variant.availableQuantity = rows.reduce((sum, row) => sum + row.quantityAvailable, 0);
        }
      }
    } else {
      product.stockQuantity = positions.reduce((sum, row) => sum + row.quantityOnHand, 0);
      product.reservedQuantity = positions.reduce((sum, row) => sum + row.quantityReserved, 0);
      product.availableQuantity = positions.reduce((sum, row) => sum + row.quantityAvailable, 0);
    }
  }
  const available = product.variants.length > 0 ? product.variants.some((variant) => !variant.inventoryTracking || variant.availableQuantity > 0) : !product.inventoryTracking || product.availableQuantity > 0;
  if (product.moderationStatus === 'approved' && ['active', 'sold_out'].includes(product.status)) product.status = available ? 'active' : 'sold_out';
  await product.save();
  return product;
}

async function adjustLegacy({ businessId, productId, variantId, delta, actorId, reason }) {
  const product = await Product.findOne({ _id: productId, businessId });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const current = targetValues(product, variantId);
  if (!current.tracked) throw new AppError(400, 'INVENTORY_NOT_TRACKED', 'Inventory tracking is disabled for this item');
  const query = { _id: productId, businessId };
  if (variantId) query.variants = { $elemMatch: { variantId, inventoryTracking: true, ...(delta < 0 ? { availableQuantity: { $gte: Math.abs(delta) } } : {}) } };
  else { query.inventoryTracking = true; if (delta < 0) query.availableQuantity = { $gte: Math.abs(delta) }; }
  const update = variantId ? { $inc: { 'variants.$.stockQuantity': delta, 'variants.$.availableQuantity': delta } } : { $inc: { stockQuantity: delta, availableQuantity: delta } };
  const updated = await Product.findOneAndUpdate(query, update, { new: true });
  if (!updated) throw new AppError(409, 'INVENTORY_CONFLICT', 'Inventory changed while this adjustment was being applied');
  const next = targetValues(updated, variantId);
  await InventoryMovement.create({ productId, businessId, variantId: variantId || null, type: delta > 0 ? 'restock' : 'manual_adjustment', quantityDelta: delta, stockBefore: next.stock - delta, stockAfter: next.stock, actorId, reason });
  return refreshAvailability(productId);
}

async function adjustInventory({ businessId, locationId = null, productId, variantId, delta, actorId, reason }) {
  if (!Number.isInteger(delta) || delta === 0) throw new AppError(400, 'INVALID_INVENTORY_DELTA', 'Inventory adjustment must be a non-zero whole number');
  if (!locationId) return adjustLegacy({ businessId, productId, variantId, delta, actorId, reason });
  const product = await Product.findOne({ _id: productId, businessId });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const position = await ensurePosition({ businessId, locationId, product, variantId });
  if (!position.inventoryTracking) throw new AppError(400, 'INVENTORY_NOT_TRACKED', 'Inventory tracking is disabled for this item');
  const query = { _id: position._id, quantityAvailable: delta < 0 ? { $gte: Math.abs(delta) } : { $gte: 0 } };
  const updated = await InventoryPosition.findOneAndUpdate(query, { $inc: { quantityOnHand: delta, quantityAvailable: delta } }, { new: true });
  if (!updated) throw new AppError(409, 'INVENTORY_CONFLICT', 'Inventory changed while this adjustment was being applied');
  await InventoryMovement.create({ productId, businessId, locationId, variantId: variantId || null, type: delta > 0 ? 'restock' : 'manual_adjustment', quantityDelta: delta, stockBefore: updated.quantityOnHand - delta, stockAfter: updated.quantityOnHand, actorId, reason });
  await refreshAvailability(productId);
  return { product: await Product.findById(productId), position: updated };
}

async function releaseReservation(reservationId, actorId, reason = 'Reservation expired or was cancelled') {
  const reservation = await InventoryReservation.findOneAndUpdate({ _id: reservationId, status: 'active' }, { $set: { status: 'released' } }, { new: true });
  if (!reservation) return null;
  let product;
  if (reservation.locationId) {
    await InventoryPosition.findOneAndUpdate({ businessId: reservation.businessId, locationId: reservation.locationId, productId: reservation.productId, variantKey: variantKey(reservation.variantId) }, { $inc: { quantityReserved: -reservation.quantity, quantityAvailable: reservation.quantity } });
    await InventoryMovement.create({ productId: reservation.productId, businessId: reservation.businessId, locationId: reservation.locationId, variantId: reservation.variantId, type: 'reservation_release', quantityDelta: reservation.quantity, referenceType: 'reservation', referenceId: reservation._id, actorId, reason, stockBefore: 0, stockAfter: 0 });
  } else {
    product = reservation.variantId ? await Product.findOneAndUpdate({ _id: reservation.productId, 'variants.variantId': reservation.variantId }, { $inc: { 'variants.$.reservedQuantity': -reservation.quantity, 'variants.$.availableQuantity': reservation.quantity } }, { new: true }) : await Product.findOneAndUpdate({ _id: reservation.productId }, { $inc: { reservedQuantity: -reservation.quantity, availableQuantity: reservation.quantity } }, { new: true });
    if (product) await InventoryMovement.create({ productId: reservation.productId, businessId: reservation.businessId, variantId: reservation.variantId, type: 'reservation_release', quantityDelta: reservation.quantity, stockBefore: targetValues(product, reservation.variantId).stock, stockAfter: targetValues(product, reservation.variantId).stock, referenceType: 'reservation', referenceId: reservation._id, actorId, reason });
  }
  await refreshAvailability(reservation.productId);
  return reservation;
}

async function releaseExpiredReservations() {
  const expired = await InventoryReservation.find({ status: 'active', expiresAt: { $lte: new Date() } }).select('_id').limit(100);
  for (const reservation of expired) await releaseReservation(reservation._id, null, 'Reservation expired');
  return expired.length;
}

async function reserveStock({ productId, businessId, locationId = null, variantId, userId, quantity, orderId = null, expiresInMinutes = 15, cleanupExpired = true }) {
  if (cleanupExpired) await releaseExpiredReservations();
  const product = await Product.findOne({ _id: productId, businessId, status: 'active', moderationStatus: 'approved' });
  if (!product) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'This item is no longer available');
  if (locationId) {
    const position = await ensurePosition({ businessId, locationId, product, variantId });
    const updated = await InventoryPosition.findOneAndUpdate({ _id: position._id, inventoryTracking: true, quantityAvailable: { $gte: quantity } }, { $inc: { quantityReserved: quantity, quantityAvailable: -quantity } }, { new: true });
    if (!updated) throw new AppError(409, 'INSUFFICIENT_STOCK_AT_LOCATION', 'This item is not available at the selected branch');
    const reservation = await InventoryReservation.create({ productId, businessId, locationId, variantId: variantId || null, userId, orderId, quantity, status: 'active', expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000) });
    await InventoryMovement.create({ productId, businessId, locationId, variantId: variantId || null, type: 'reservation', quantityDelta: -quantity, stockBefore: updated.quantityOnHand, stockAfter: updated.quantityOnHand, referenceType: 'reservation', referenceId: reservation._id, actorId: userId, reason: 'Checkout reservation' });
    await refreshAvailability(productId);
    return reservation;
  }
  const current = targetValues(product, variantId);
  const query = { _id: productId, businessId, status: 'active', moderationStatus: 'approved' };
  const update = variantId ? { $inc: { 'variants.$.reservedQuantity': quantity, 'variants.$.availableQuantity': -quantity } } : { $inc: { reservedQuantity: quantity, availableQuantity: -quantity } };
  if (variantId) query.variants = { $elemMatch: { variantId, active: true, inventoryTracking: true, availableQuantity: { $gte: quantity } } }; else { query.inventoryTracking = true; query.availableQuantity = { $gte: quantity }; }
  const updated = await Product.findOneAndUpdate(query, update, { new: true });
  if (!updated) throw new AppError(409, 'INSUFFICIENT_STOCK', 'This item is no longer available in the requested quantity');
  const reservation = await InventoryReservation.create({ productId, businessId, variantId: variantId || null, userId, orderId, quantity, status: 'active', expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000) });
  await InventoryMovement.create({ productId, businessId, variantId: variantId || null, type: 'reservation', quantityDelta: -quantity, stockBefore: current.stock, stockAfter: current.stock, referenceType: 'reservation', referenceId: reservation._id, actorId: userId, reason: 'Checkout reservation' });
  await refreshAvailability(productId);
  return reservation;
}

async function releaseOrderReservations(orderId, actorId, reason) {
  const reservations = await InventoryReservation.find({ orderId, status: 'active' }).select('_id');
  for (const reservation of reservations) await releaseReservation(reservation._id, actorId, reason);
  return reservations.length;
}

async function consumeOrderReservations(orderId) {
  const reservations = await InventoryReservation.find({ orderId, status: 'active' });
  for (const reservation of reservations) {
    const claimed = await InventoryReservation.findOneAndUpdate({ _id: reservation._id, status: 'active' }, { $set: { status: 'consumed', expiresAt: new Date('9999-12-31T23:59:59.999Z') } }, { new: true });
    if (!claimed) continue;
    let stockUpdated = false;
    try {
      if (reservation.locationId) {
        const result = await InventoryPosition.updateOne({ businessId: reservation.businessId, locationId: reservation.locationId, productId: reservation.productId, variantKey: variantKey(reservation.variantId), quantityReserved: { $gte: reservation.quantity }, quantityOnHand: { $gte: reservation.quantity } }, { $inc: { quantityReserved: -reservation.quantity, quantityOnHand: -reservation.quantity } });
        if (!result.modifiedCount) throw new AppError(409, 'INVENTORY_CONSUMPTION_CONFLICT', 'Reserved inventory changed before payment settlement');
        stockUpdated = true;
        await InventoryMovement.create({ productId: reservation.productId, businessId: reservation.businessId, locationId: reservation.locationId, variantId: reservation.variantId, type: 'sale', quantityDelta: -reservation.quantity, referenceType: 'order', referenceId: orderId, actorId: null, reason: 'Paid order', stockBefore: 0, stockAfter: 0 });
      } else {
        const update = reservation.variantId ? { $inc: { 'variants.$.reservedQuantity': -reservation.quantity, 'variants.$.stockQuantity': -reservation.quantity } } : { $inc: { reservedQuantity: -reservation.quantity, stockQuantity: -reservation.quantity } };
        const result = await Product.updateOne(reservation.variantId ? { _id: reservation.productId, variants: { $elemMatch: { variantId: reservation.variantId, reservedQuantity: { $gte: reservation.quantity }, stockQuantity: { $gte: reservation.quantity } } } } : { _id: reservation.productId, reservedQuantity: { $gte: reservation.quantity }, stockQuantity: { $gte: reservation.quantity } }, update);
        if (!result.modifiedCount) throw new AppError(409, 'INVENTORY_CONSUMPTION_CONFLICT', 'Reserved inventory changed before payment settlement');
        stockUpdated = true;
        await InventoryMovement.create({ productId: reservation.productId, businessId: reservation.businessId, variantId: reservation.variantId, type: 'sale', quantityDelta: -reservation.quantity, referenceType: 'order', referenceId: orderId, actorId: null, reason: 'Paid order', stockBefore: 0, stockAfter: 0 });
      }
      await refreshAvailability(reservation.productId);
    } catch (error) {
      // A failed stock update must remain retryable. Once stock moved, leave the
      // reservation consumed so a retry cannot decrement inventory twice.
      if (!stockUpdated) await InventoryReservation.updateOne({ _id: claimed._id, status: 'consumed' }, { $set: { status: 'active', expiresAt: new Date(Date.now() + 15 * 60_000) } });
      throw error;
    }
  }
  return reservations.length;
}

function transferNumber() { return `SCV-TRF-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

async function transferStock({ businessId, sourceLocationId, destinationLocationId, productId, variantId = null, quantity, actorId, reason }) {
  if (sourceLocationId.toString() === destinationLocationId.toString()) throw new AppError(400, 'TRANSFER_LOCATIONS_MUST_DIFFER', 'Choose different source and destination locations');
  const [source, destination, product] = await Promise.all([assertLocation(businessId, sourceLocationId), assertLocation(businessId, destinationLocationId), Product.findOne({ _id: productId, businessId })]);
  if (!source || !destination) throw new AppError(404, 'BUSINESS_LOCATION_NOT_FOUND', 'Both transfer locations must belong to this business');
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const sourcePosition = await ensurePosition({ businessId, locationId: sourceLocationId, product, variantId });
  const destinationPosition = await ensurePosition({ businessId, locationId: destinationLocationId, product, variantId });
  const transfer = await StockTransfer.create({ transferNumber: transferNumber(), businessId, sourceLocationId, destinationLocationId, productId, variantId, quantity, reason, status: 'pending', createdBy: actorId });
  const moved = await InventoryPosition.findOneAndUpdate({ _id: sourcePosition._id, quantityAvailable: { $gte: quantity } }, { $inc: { quantityOnHand: -quantity, quantityAvailable: -quantity } }, { new: true });
  if (!moved) { await StockTransfer.updateOne({ _id: transfer._id }, { $set: { status: 'cancelled', cancelledBy: actorId, cancelledAt: new Date() } }); throw new AppError(409, 'INSUFFICIENT_STOCK', 'There is not enough available stock at the source branch'); }
  const received = await InventoryPosition.findOneAndUpdate({ _id: destinationPosition._id }, { $inc: { quantityOnHand: quantity, quantityAvailable: quantity } }, { new: true });
  if (!received) { await InventoryPosition.updateOne({ _id: sourcePosition._id }, { $inc: { quantityOnHand: quantity, quantityAvailable: quantity } }); throw new AppError(409, 'TRANSFER_CONFLICT', 'The destination inventory changed while the transfer was being applied'); }
  await Promise.all([
    InventoryMovement.create({ productId, businessId, locationId: sourceLocationId, variantId, type: 'transfer_out', quantityDelta: -quantity, stockBefore: moved.quantityOnHand + quantity, stockAfter: moved.quantityOnHand, referenceType: 'stock_transfer', referenceId: transfer._id, actorId, reason }),
    InventoryMovement.create({ productId, businessId, locationId: destinationLocationId, variantId, type: 'transfer_in', quantityDelta: quantity, stockBefore: received.quantityOnHand - quantity, stockAfter: received.quantityOnHand, referenceType: 'stock_transfer', referenceId: transfer._id, actorId, reason })
  ]);
  transfer.status = 'received'; transfer.receivedBy = actorId; transfer.receivedAt = new Date(); await transfer.save();
  await refreshAvailability(productId);
  return transfer;
}

async function listPositions({ businessId, locationId, productId, page = 1, limit = 50 }) {
  const filter = { businessId, ...(locationId ? { locationId } : {}), ...(productId ? { productId } : {}) };
  const skip = (page - 1) * limit;
  const [positions, total] = await Promise.all([InventoryPosition.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit), InventoryPosition.countDocuments(filter)]);
  const products = await Product.find({ _id: { $in: positions.map((position) => position.productId) } }).select('name slug');
  const productMap = new Map(products.map((product) => [product._id.toString(), { id: product._id.toString(), name: product.name, slug: product.slug }]));
  return { positions: positions.map((position) => ({ ...position.toSafeJSON(), product: productMap.get(position.productId.toString()) || null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function forecast({ businessId, locationId = null, productId = null, days = 30 }) {
  const since = new Date(Date.now() - days * 86_400_000);
  const positions = await InventoryPosition.find({ businessId, ...(locationId ? { locationId } : {}), ...(productId ? { productId } : {}) }).select('productId variantId locationId quantityAvailable lowStockThreshold').lean();
  const sales = await InventoryMovement.aggregate([{ $match: { businessId, type: 'sale', createdAt: { $gte: since }, ...(locationId ? { locationId } : {}), ...(productId ? { productId } : {}) } }, { $group: { _id: { productId: '$productId', variantId: '$variantId', locationId: '$locationId' }, unitsSold: { $sum: { $abs: '$quantityDelta' } } } }]);
  const products = await Product.find({ _id: { $in: positions.map((item) => item.productId) } }).select('name slug').lean();
  const rows = positions.map((position) => {
    const sale = sales.find((item) => String(item._id.productId) === String(position.productId) && String(item._id.variantId || '') === String(position.variantId || '') && String(item._id.locationId || '') === String(position.locationId || ''));
    const unitsSold = sale?.unitsSold || 0;
    const dailyAverage = Number((unitsSold / days).toFixed(2));
    const daysOfCover = dailyAverage > 0 ? Number((position.quantityAvailable / dailyAverage).toFixed(1)) : null;
    return { ...position, id: position._id.toString(), product: products.find((item) => item._id.toString() === position.productId.toString()) || null, unitsSold, dailyAverage, daysOfCover, restockRecommended: position.quantityAvailable <= position.lowStockThreshold || (daysOfCover !== null && daysOfCover <= 7) };
  });
  return { periodDays: days, since, positions: rows.sort((a, b) => Number(b.restockRecommended) - Number(a.restockRecommended) || (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)) };
}

function inventoryForecastCsv(positions = []) {
  const cell = (value) => { const text = value === null || value === undefined ? '' : String(value); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  const header = ['product_id', 'product_name', 'location_id', 'quantity_on_hand', 'quantity_reserved', 'quantity_available', 'low_stock_threshold', 'units_sold', 'daily_average', 'days_of_cover', 'restock_recommended'];
  const rows = positions.map((position) => [position.productId, position.product?.name || '', position.locationId, position.quantityOnHand, position.quantityReserved, position.quantityAvailable, position.lowStockThreshold, position.unitsSold, position.dailyAverage, position.daysOfCover, position.restockRecommended].map(cell).join(','));
  return [header.join(','), ...rows].join('\n') + '\n';
}

async function processLowStockAlerts({ now = new Date(), limit = 500 } = {}) {
  const dayKey = now.toISOString().slice(0, 10);
  const positions = await InventoryPosition.find({ inventoryTracking: true, $expr: { $lte: ['$quantityAvailable', '$lowStockThreshold'] } }).sort({ quantityAvailable: 1, updatedAt: 1 }).limit(Math.min(Math.max(limit, 1), 500)).lean();
  if (!positions.length) return { positions: 0, notifications: 0 };
  const businessIds = [...new Set(positions.map((position) => position.businessId.toString()))];
  const productIds = [...new Set(positions.map((position) => position.productId.toString()))];
  const locationIds = [...new Set(positions.map((position) => position.locationId.toString()))];
  const [memberships, products, locations] = await Promise.all([
    BusinessMembership.find({ businessId: { $in: businessIds }, status: 'active', permissions: { $in: ['*', 'inventory.read', 'inventory.manage'] } }).select('userId businessId').lean(),
    Product.find({ _id: { $in: productIds } }).select('name').lean(),
    BusinessLocation.find({ _id: { $in: locationIds } }).select('name').lean()
  ]);
  const productMap = new Map(products.map((product) => [product._id.toString(), product.name]));
  const locationMap = new Map(locations.map((location) => [location._id.toString(), location.name]));
  const membersByBusiness = new Map();
  for (const membership of memberships) {
    const key = membership.businessId.toString();
    if (!membersByBusiness.has(key)) membersByBusiness.set(key, []);
    membersByBusiness.get(key).push(membership.userId.toString());
  }
  let notifications = 0;
  for (const position of positions) {
    const users = membersByBusiness.get(position.businessId.toString()) || [];
    for (const userId of users) {
      const notification = await createNotification({
        userId,
        type: 'inventory_low_stock',
        title: 'Stock is running low',
        body: `${productMap.get(position.productId.toString()) || 'A product'} has ${position.quantityAvailable} available at ${locationMap.get(position.locationId.toString()) || 'a branch'}.`,
        data: { businessId: position.businessId.toString(), positionId: position._id.toString(), productId: position.productId.toString(), locationId: position.locationId.toString() },
        deduplicationKey: lowStockNotificationKey(position._id, userId, dayKey)
      });
      if (notification) notifications += 1;
    }
  }
  return { positions: positions.length, notifications };
}

function lowStockNotificationKey(positionId, userId, dayKey) {
  return `inventory-low-stock:${positionId.toString()}:${userId.toString()}:${dayKey}`;
}

module.exports = { targetValues, primaryLocation, ensurePosition, refreshAvailability, adjustInventory, reserveStock, releaseReservation, releaseExpiredReservations, releaseOrderReservations, consumeOrderReservations, transferStock, listPositions, forecast, inventoryForecastCsv, processLowStockAlerts, lowStockNotificationKey, variantKey };
