const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { User } = require('../users/user.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { BookingSlotLock } = require('../bookings/booking-slot-lock.model');
const { Payment } = require('./payment.model');
const { PaymentEvent } = require('./payment-event.model');
const { Refund } = require('./refund.model');
const { LedgerEntry } = require('../payouts/ledger-entry.model');
const { Payout } = require('../payouts/payout.model');
const inventoryService = require('../inventory/inventory.service');
const { getPaymentProvider } = require('../../integrations/payments');
const promotionService = require('../promotions/promotion.service');

function paymentReference() { return `SCV-PAY-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function refundNumber() { return `SCV-RFD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function payoutNumber() { return `SCV-PAYO-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function payloadHash(rawBody) { return crypto.createHash('sha256').update(rawBody).digest('hex'); }

async function findIdempotentPayment(userId, idempotencyKey, type) {
  const existing = await Payment.findOne({ idempotencyKey });
  if (!existing) return null;
  if (existing.customerId?.toString() !== userId.toString() || existing.type !== type) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This payment idempotency key cannot be reused for a different customer or payment type');
  }
  return existing;
}

async function createPaymentRecord(data) {
  try {
    return { payment: await Payment.create(data), created: true };
  } catch (error) {
    if (error?.code === 11000 && error.keyPattern?.idempotencyKey) {
      return { payment: await findIdempotentPayment(data.customerId, data.idempotencyKey, data.type), created: false };
    }
    throw error;
  }
}

function canReusePayment(payment) {
  return payment && (payment.status !== 'initialized' || Boolean(payment.authorizationUrl));
}

async function resolveTarget(userId, type, targetId) {
  if (!mongoose.isValidObjectId(targetId)) throw new AppError(400, 'INVALID_PAYMENT_TARGET', 'The payment target is invalid');
  if (type === 'order') {
    const order = await Order.findOne({ _id: targetId, customerId: userId });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
    if (order.status !== 'pending_payment' || ['successful', 'refunded', 'partially_refunded'].includes(order.paymentStatus)) throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order is not awaiting payment');
    return { target: order, amountMinor: order.totalMinor, currency: order.currency, orderId: order._id, bookingId: null, businessId: order.businessIds[0] };
  }
  const booking = await Booking.findOne({ _id: targetId, customerId: userId });
  if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  if (['successful', 'refunded', 'partially_refunded'].includes(booking.paymentStatus)) throw new AppError(409, 'BOOKING_ALREADY_PAID', 'This booking already has a successful payment');
  const amountMinor = booking.depositMinor > 0 && booking.depositMinor < booking.priceMinor ? booking.depositMinor : booking.priceMinor;
  return { target: booking, amountMinor, currency: booking.currency, orderId: null, bookingId: booking._id, businessId: booking.businessId };
}

async function updateTargetPayment(targetData, payment, note) {
  const target = targetData.target;
  target.paymentStatus = 'pending';
  target.paymentReference = payment.reference;
  if (target.timeline) target.timeline.push({ status: target.status, actorId: target.customerId, note });
  await target.save();
}

async function initializePayment(userId, type, targetId, input = {}) {
  const idempotencyKey = input.idempotencyKey || `${type}:${targetId}:${userId}`;
  const existing = await findIdempotentPayment(userId, idempotencyKey, type);
  if (canReusePayment(existing)) return existing;
  const provider = getPaymentProvider(input.provider || 'paystack');
  const customer = await User.findById(userId).select('email firstName lastName');
  if (!customer) throw new AppError(404, 'USER_NOT_FOUND', 'Customer not found');
  const targetData = await resolveTarget(userId, type, targetId);
  const activePayment = await Payment.findOne({ ...(type === 'order' ? { orderId: targetData.orderId } : { bookingId: targetData.bookingId }), status: { $in: ['initialized', 'pending', 'successful'] } }).sort({ createdAt: -1 });
  if (activePayment) return activePayment;
  const { payment, created } = await createPaymentRecord({ reference: paymentReference(), idempotencyKey, provider: provider.name, type, customerId: userId, orderId: targetData.orderId, bookingId: targetData.bookingId, amountMinor: targetData.amountMinor, currency: targetData.currency, status: 'initialized', metadata: { scovrrType: type, scovrrId: targetId.toString(), businessId: targetData.businessId.toString() } });
  if (!created && canReusePayment(payment)) return payment;
  try {
    const result = await provider.initializeTransaction({ amountMinor: payment.amountMinor, currency: payment.currency, email: customer.email, reference: payment.reference, metadata: payment.metadata });
    payment.status = 'pending';
    payment.providerReference = result.reference || payment.reference;
    payment.authorizationUrl = result.authorization_url || null;
    payment.accessCode = result.access_code || null;
    await payment.save();
    await updateTargetPayment(targetData, payment, 'Payment initialized with the payment provider.');
    return payment;
  } catch (error) {
    payment.status = 'failed';
    payment.failureReason = error.message;
    await payment.save();
    throw error;
  }
}

async function initializeSubscriptionPayment(userId, businessId, input = {}) {
  const subscriptionService = require('../subscriptions/subscription.service');
  const idempotencyKey = input.idempotencyKey || `subscription:${businessId}:${input.planVersionId || input.planCode}:${input.billingInterval || 'monthly'}`;
  const existing = await findIdempotentPayment(userId, idempotencyKey, 'subscription');
  if (canReusePayment(existing)) return existing;
  const provider = getPaymentProvider(input.provider || 'paystack');
  const customer = await User.findById(userId).select('email firstName lastName');
  if (!customer) throw new AppError(404, 'USER_NOT_FOUND', 'Customer not found');
  const checkout = await subscriptionService.prepareCheckout(businessId, input);
  const invoice = await subscriptionService.createInvoiceForCheckout({ businessId, subscription: checkout.subscription, version: checkout.version, price: checkout.price, idempotencyKey: `invoice:${idempotencyKey}` });
  const attempt = await subscriptionService.createBillingAttempt({ subscription: checkout.subscription, invoice, amountMinor: checkout.price.amountMinor, currency: checkout.price.currency, idempotencyKey: `attempt:${idempotencyKey}` });
  const { payment, created } = await createPaymentRecord({ reference: paymentReference(), idempotencyKey, provider: provider.name, type: 'subscription', customerId: userId, businessId, subscriptionId: checkout.subscription._id, invoiceId: invoice._id, amountMinor: checkout.price.amountMinor, currency: checkout.price.currency, status: 'initialized', metadata: { scovrrType: 'subscription', businessId: businessId.toString(), subscriptionId: checkout.subscription._id.toString(), invoiceId: invoice._id.toString(), planVersionId: checkout.version._id.toString(), billingInterval: checkout.price.billingInterval } });
  if (!created && canReusePayment(payment)) return payment;
  try {
    const result = await provider.initializeTransaction({ amountMinor: payment.amountMinor, currency: payment.currency, email: customer.email, reference: payment.reference, metadata: payment.metadata });
    payment.status = 'pending';
    payment.providerReference = result.reference || payment.reference;
    payment.authorizationUrl = result.authorization_url || null;
    payment.accessCode = result.access_code || null;
    await payment.save();
    attempt.status = 'pending'; attempt.providerReference = payment.providerReference; await attempt.save();
    return payment;
  } catch (error) {
    payment.status = 'failed'; payment.failureReason = error.message; await payment.save();
    invoice.status = 'failed'; await invoice.save();
    attempt.status = 'failed'; attempt.errorCategory = error.code || 'provider_error'; attempt.completedAt = new Date(); await attempt.save();
    throw error;
  }
}

async function initializePromotionPayment(userId, campaign, funding, input = {}) {
  const idempotencyKey = input.idempotencyKey || funding.idempotencyKey;
  const existing = await findIdempotentPayment(userId, idempotencyKey, 'promotion');
  if (canReusePayment(existing)) return existing;
  const provider = getPaymentProvider(input.provider || 'paystack');
  const customer = await User.findById(userId).select('email firstName lastName');
  if (!customer) throw new AppError(404, 'USER_NOT_FOUND', 'Customer not found');
  if (funding.status !== 'initialized' && funding.status !== 'pending') throw new AppError(409, 'PROMOTION_FUNDING_NOT_PAYABLE', 'This promotion funding attempt is no longer payable');
  const { payment, created } = await createPaymentRecord({ reference: paymentReference(), idempotencyKey, provider: provider.name, type: 'promotion', customerId: userId, businessId: campaign.businessId, campaignId: campaign._id, promotionFundingId: funding._id, amountMinor: funding.amountMinor, currency: funding.currency, status: 'initialized', metadata: { scovrrType: 'promotion', businessId: campaign.businessId.toString(), campaignId: campaign._id.toString(), promotionFundingId: funding._id.toString() } });
  if (!created && canReusePayment(payment)) return payment;
  try {
    const result = await provider.initializeTransaction({ amountMinor: payment.amountMinor, currency: payment.currency, email: customer.email, reference: payment.reference, metadata: payment.metadata });
    payment.status = 'pending'; payment.providerReference = result.reference || payment.reference; payment.authorizationUrl = result.authorization_url || null; payment.accessCode = result.access_code || null; await payment.save();
    funding.paymentId = payment._id; funding.status = 'pending'; await funding.save();
    return payment;
  } catch (error) {
    payment.status = 'failed'; payment.failureReason = error.message; await payment.save(); funding.status = 'failed'; funding.failureReason = error.message; await funding.save(); throw error;
  }
}

async function createLedgerEntry(input) {
  return LedgerEntry.findOneAndUpdate({ idempotencyKey: input.idempotencyKey }, { $setOnInsert: input }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function createPayoutForPayment(payment, businessId, amountMinor, currency) {
  const eligibleAt = new Date(Date.now() + env.payoutHoldDays * 24 * 60 * 60 * 1_000);
  return Payout.findOneAndUpdate({ sourcePaymentId: payment._id }, { $setOnInsert: { payoutNumber: payoutNumber(), sourcePaymentId: payment._id, businessId, amountMinor, currency, provider: env.payoutProvider, eligibleAt, status: env.payoutHoldDays > 0 ? 'pending' : 'eligible' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function recordSettlementLedger(payment, businessId) {
  if (payment.type === 'subscription') {
    return createLedgerEntry({ idempotencyKey: `payment:${payment._id}:subscription`, accountType: 'platform', accountId: null, businessId: businessId || payment.businessId, paymentId: payment._id, type: 'subscription_payment', direction: 'credit', amountMinor: payment.amountMinor, currency: payment.currency, metadata: { provider: payment.provider, subscriptionId: payment.subscriptionId?.toString() || null, invoiceId: payment.invoiceId?.toString() || null } });
  }
  if (payment.type === 'promotion') {
    return createLedgerEntry({ idempotencyKey: `payment:${payment._id}:promotion`, accountType: 'platform', accountId: null, businessId: businessId || payment.businessId, paymentId: payment._id, type: 'promotion_funding', direction: 'credit', amountMinor: payment.amountMinor, currency: payment.currency, metadata: { provider: payment.provider, campaignId: payment.campaignId?.toString() || null, promotionFundingId: payment.promotionFundingId?.toString() || null } });
  }
  const commissionMinor = Math.min(Math.max(payment.amountMinor - 1, 0), Math.floor(payment.amountMinor * env.platformCommissionBps / 10_000));
  const sellerAmountMinor = payment.amountMinor - commissionMinor;
  const targetFields = { paymentId: payment._id, orderId: payment.orderId, bookingId: payment.bookingId, currency: payment.currency };
  await createLedgerEntry({ ...targetFields, idempotencyKey: `payment:${payment._id}:customer`, accountType: 'platform', accountId: null, type: 'customer_payment', direction: 'credit', amountMinor: payment.amountMinor, metadata: { provider: payment.provider } });
  if (commissionMinor > 0) await createLedgerEntry({ ...targetFields, idempotencyKey: `payment:${payment._id}:commission`, accountType: 'platform', accountId: null, type: 'platform_commission', direction: 'credit', amountMinor: commissionMinor, metadata: { commissionBps: env.platformCommissionBps } });
  if (sellerAmountMinor > 0) await createLedgerEntry({ ...targetFields, idempotencyKey: `payment:${payment._id}:seller`, accountType: 'business', accountId: businessId, businessId, type: 'seller_credit', direction: 'credit', amountMinor: sellerAmountMinor, metadata: { grossAmountMinor: payment.amountMinor, commissionMinor } });
  await createPayoutForPayment(payment, businessId, sellerAmountMinor, payment.currency);
}

async function settleSuccessfulPayment(payment, providerData = {}) {
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const providerAmount = Number(providerData.amount);
  if (providerData.amount !== undefined && providerAmount !== payment.amountMinor) throw new AppError(409, 'PAYMENT_AMOUNT_MISMATCH', 'The provider amount does not match the SCOVRR payment');
  if (providerData.currency && providerData.currency !== payment.currency) throw new AppError(409, 'PAYMENT_CURRENCY_MISMATCH', 'The provider currency does not match the SCOVRR payment');
  if (payment.status === 'successful' && !['failed', 'processing'].includes(payment.settlementStatus)) {
    if (payment.type === 'promotion') await require('../advertising/promotion.service').activateFromFundingPayment(payment, providerData);
    return payment;
  }
  if (payment.settlementStatus === 'processing') throw new AppError(409, 'PAYMENT_SETTLEMENT_IN_PROGRESS', 'This payment is already being settled; retry shortly');
  const claimedPayment = await Payment.findOneAndUpdate(
    { _id: payment._id, settlementStatus: { $in: ['pending', 'failed'] }, status: { $nin: ['refunded', 'partially_refunded'] } },
    { $set: { status: 'successful', settlementStatus: 'processing', providerReference: providerData.reference || payment.providerReference || payment.reference, paidAt: payment.paidAt || new Date() } },
    { new: true }
  );
  if (!claimedPayment) {
    const current = await Payment.findById(payment._id);
    if (current?.settlementStatus === 'completed') return current;
    throw new AppError(409, 'PAYMENT_SETTLEMENT_IN_PROGRESS', 'This payment is already being settled; retry shortly');
  }
  payment = claimedPayment;
  try {
    let businessId = payment.businessId || null;
    if (payment.type === 'subscription') {
    await require('../subscriptions/subscription.service').activateFromPayment(payment, providerData);
    } else if (payment.type === 'promotion') {
    await require('../advertising/promotion.service').activateFromFundingPayment(payment, providerData);
    } else if (payment.orderId) {
    const order = await Order.findById(payment.orderId);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Payment order not found');
    businessId = order.businessIds[0];
    if (order.status === 'pending_payment') {
      // Consume the reservation before making the order payable. If inventory
      // cannot be consumed, settlement fails while the order remains retryable.
      await inventoryService.consumeOrderReservations(order._id);
      await promotionService.consumePromotionForOrder(order._id);
      order.paymentStatus = 'successful'; order.status = 'paid'; order.fulfillmentStatus = 'seller_confirmation';
      order.timeline.push({ status: 'paid', actorId: null, note: 'Payment verified by the provider.' });
      await order.save();
      await require('../analytics/domain-event.service').queue('ORDER_PAID', { userId: order.customerId, actorType: 'system', businessId, locationId: order.fulfillmentLocationId, entityType: 'order', entityId: order._id, metadata: { orderId: order._id.toString(), paymentId: payment._id.toString(), amountMinor: payment.amountMinor, currency: payment.currency, discountMinor: order.discountMinor } }, `order:${order._id}:paid`);
      try { await require('../advertising/promotion-event.service').recordConversionForOrder(order); } catch (error) { console.error('Unable to record promotion order attribution:', error.message); }
    } else {
      order.paymentStatus = 'successful';
      order.timeline.push({ status: order.status, actorId: null, note: 'Payment verified after the order had already changed state; reconciliation may be required.' });
      await order.save();
    }
    } else if (payment.bookingId) {
    const booking = await Booking.findById(payment.bookingId);
    if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'Payment booking not found');
    businessId = booking.businessId;
    booking.paymentStatus = 'successful';
    if (booking.requestType === 'instant' && booking.status === 'pending_payment') {
      booking.status = 'confirmed'; booking.holdExpiresAt = null;
      await BookingSlotLock.updateMany({ bookingId: booking._id }, { $set: { expiresAt: booking.endAt } });
    }
    await promotionService.consumePromotionForBooking(booking._id);
    try { await require('../advertising/promotion-event.service').recordConversionForBooking(booking); } catch (error) { console.error('Unable to record promotion booking attribution:', error.message); }
    booking.timeline.push({ status: booking.status, actorId: null, note: 'Payment verified by the provider.' });
    await booking.save();
    await require('../analytics/domain-event.service').queue(booking.status === 'confirmed' ? 'BOOKING_CONFIRMED' : 'BOOKING_CREATED', { userId: booking.customerId, actorType: 'system', businessId: booking.businessId, locationId: booking.locationId, entityType: 'booking', entityId: booking._id, metadata: { bookingId: booking._id.toString(), paymentId: payment._id.toString(), amountMinor: payment.amountMinor, currency: payment.currency, status: booking.status } }, `booking:${booking._id}:${booking.status === 'confirmed' ? 'confirmed' : 'paid'}`);
    }
    await recordSettlementLedger(payment, businessId);
    const { createNotification } = require('../notifications/notification.service');
    await createNotification({ deduplicationKey: `payment:${payment._id}:confirmed`, userId: payment.customerId, type: 'payment_confirmed', title: 'Payment confirmed', body: `Your ${payment.type} payment has been verified.`, data: { paymentId: payment._id.toString(), orderId: payment.orderId?.toString() || null, bookingId: payment.bookingId?.toString() || null, campaignId: payment.campaignId?.toString() || null } });
    payment.settlementStatus = 'completed';
    await payment.save();
    return payment;
  } catch (error) {
    await Payment.updateOne({ _id: payment._id, settlementStatus: 'processing' }, { $set: { settlementStatus: 'failed', failureReason: error.message } });
    throw error;
  }
}

async function verifyPayment(userId, paymentId) {
  const payment = await Payment.findOne({ _id: paymentId, customerId: userId });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const provider = getPaymentProvider(payment.provider);
  const providerData = await provider.verifyTransaction(payment.providerReference || payment.reference);
  if (providerData.status !== 'success') {
    payment.status = providerData.status === 'failed' ? 'failed' : 'pending';
    payment.failureReason = providerData.gateway_response || null;
    await payment.save();
    return payment;
  }
  return settleSuccessfulPayment(payment, providerData);
}

async function processPaystackWebhook(rawBody, signature) {
  const provider = getPaymentProvider('paystack');
  if (!provider.verifyWebhookSignature(signature, rawBody)) throw new AppError(401, 'INVALID_PAYMENT_WEBHOOK', 'The payment webhook signature is invalid');
  const payload = JSON.parse(rawBody.toString('utf8'));
  const eventType = payload.event || 'unknown';
  const reference = payload.data?.reference || null;
  const eventId = String(payload.data?.id || `${eventType}:${reference || 'unknown'}:${payloadHash(rawBody)}`);
  let event = await PaymentEvent.findOne({ provider: 'paystack', eventId });
  if (event?.status === 'processed') return { duplicate: true };
  if (!event) {
    try { event = await PaymentEvent.create({ provider: 'paystack', eventId, eventType, reference, payloadHash: payloadHash(rawBody), status: 'received' }); } catch (error) {
      if (error?.code !== 11000) throw error;
      event = await PaymentEvent.findOne({ provider: 'paystack', eventId });
      if (event?.status === 'processed') return { duplicate: true };
    }
  }
  try {
    event.signatureVerified = true;
    event.lastAttemptAt = new Date();
    event.retryCount += 1;
    const payment = reference ? await Payment.findOne({ reference }) : null;
    if (eventType === 'charge.success') await settleSuccessfulPayment(payment, payload.data || {});
    else if (payment && ['charge.failed', 'charge.abandoned'].includes(eventType)) { payment.status = eventType === 'charge.failed' ? 'failed' : 'abandoned'; payment.failureReason = payload.data?.gateway_response || null; await payment.save(); }
    else if (['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(eventType)) {
      const { Payout } = require('../payouts/payout.model');
      const payout = reference ? await Payout.findOne({ providerReference: reference }) : null;
      if (!payout) throw new AppError(404, 'PAYOUT_NOT_FOUND', 'Transfer webhook does not match a SCOVRR payout');
      if (Number(payload.data?.amount) !== payout.amountMinor || (payload.data?.currency && payload.data.currency !== payout.currency)) throw new AppError(409, 'PAYOUT_PROVIDER_AMOUNT_MISMATCH', 'The transfer webhook does not match the SCOVRR payout');
      if (eventType === 'transfer.success') await require('../payouts/payout.service').markPayoutPaid(payout);
      else { payout.status = eventType === 'transfer.reversed' ? 'reversed' : 'failed'; payout.failureReason = payload.data?.reason || `Provider transfer status: ${eventType}`; await payout.save(); }
    }
    event.status = 'processed'; event.processedAt = new Date(); event.nextRetryAt = null; await event.save();
    return { duplicate: false, eventType };
  } catch (error) {
    event.status = 'failed'; event.failureReason = error.message; event.nextRetryAt = new Date(Date.now() + Math.min(15 * 60 * 1_000, 1_000 * (2 ** Math.max(event.retryCount - 1, 0)))); await event.save(); throw error;
  }
}

async function requestRefund(adminId, paymentId, input) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  if (!['successful', 'partially_refunded'].includes(payment.status)) throw new AppError(409, 'PAYMENT_NOT_REFUNDABLE', 'Only settled payments can be refunded');
  const promotionUnusedMinor = payment.type === 'promotion' ? await (async () => {
    const { PromotionCampaign } = require('../advertising/promotion-campaign.model');
    const campaign = payment.campaignId ? await PromotionCampaign.findById(payment.campaignId).select('fundedMinor spentMinor reservedMinor refundedMinor') : null;
    return campaign ? Math.max(campaign.fundedMinor - campaign.spentMinor - campaign.reservedMinor - campaign.refundedMinor, 0) : 0;
  })() : null;
  const amountMinor = input.amountMinor ?? (payment.type === 'promotion' ? promotionUnusedMinor : payment.amountMinor - payment.refundedAmountMinor);
  if (amountMinor < 1 || amountMinor > payment.amountMinor - payment.refundedAmountMinor) throw new AppError(400, 'INVALID_REFUND_AMOUNT', 'Refund amount exceeds the refundable balance');
  if (payment.type === 'promotion' && amountMinor > promotionUnusedMinor) throw new AppError(400, 'PROMOTION_REFUND_EXCEEDS_UNUSED_BALANCE', 'Only the unused promotion balance can be refunded');
  const idempotencyKey = input.idempotencyKey || `refund:${payment._id}:${amountMinor}`;
  const existing = await Refund.findOne({ idempotencyKey });
  if (existing) return existing;
  const provider = getPaymentProvider(payment.provider);
  let refund;
  try {
    refund = await Refund.create({ refundNumber: refundNumber(), idempotencyKey, paymentId: payment._id, businessId: payment.businessId, orderId: payment.orderId, bookingId: payment.bookingId, subscriptionId: payment.subscriptionId, invoiceId: payment.invoiceId, campaignId: payment.campaignId, promotionFundingId: payment.promotionFundingId, amountMinor, currency: payment.currency, reason: input.reason, requestedBy: adminId, approvedBy: adminId, status: 'processing' });
  } catch (error) {
    if (error?.code === 11000) return Refund.findOne({ idempotencyKey });
    throw error;
  }
  try {
    const result = await provider.refundTransaction({ providerReference: payment.providerReference || payment.reference, amountMinor });
    refund.providerReference = result.transaction?.toString() || result.id?.toString() || null;
    refund.status = result.status === 'processed' ? 'completed' : 'processing';
    await refund.save();
    if (refund.status === 'completed') await completeRefund(refund);
    return refund;
  } catch (error) {
    if (refund.status !== 'completed') { refund.status = 'failed'; refund.failureReason = error.message; await refund.save(); }
    throw error;
  }
}

async function completeRefund(refund) {
  const payment = await Payment.findById(refund.paymentId);
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Refund payment not found');
  if (refund.status === 'completed' && await LedgerEntry.exists({ idempotencyKey: `refund:${refund._id}:platform` })) return payment;
  const settledPayment = await Payment.findOneAndUpdate(
    { _id: payment._id, status: { $in: ['successful', 'partially_refunded'] }, $expr: { $lte: [{ $add: ['$refundedAmountMinor', refund.amountMinor] }, '$amountMinor'] } },
    [{ $set: { refundedAmountMinor: { $add: ['$refundedAmountMinor', refund.amountMinor] } } }, { $set: { status: { $cond: [{ $gte: ['$refundedAmountMinor', '$amountMinor'] }, 'refunded', 'partially_refunded'] } } }],
    { new: true }
  );
  if (!settledPayment) {
    const currentRefund = await Refund.findById(refund._id).select('status');
    if (currentRefund?.status === 'completed') return Payment.findById(refund.paymentId);
    const ledgerAlreadyRecorded = await LedgerEntry.exists({ idempotencyKey: `refund:${refund._id}:platform` });
    if (ledgerAlreadyRecorded) { await Refund.updateOne({ _id: refund._id }, { $set: { status: 'completed' } }); return Payment.findById(refund.paymentId); }
    throw new AppError(409, 'REFUND_SETTLEMENT_CONFLICT', 'The refund could not be applied safely; retry reconciliation');
  }
  payment.status = settledPayment.status;
  payment.refundedAmountMinor = settledPayment.refundedAmountMinor;
  const businessId = payment.businessId || (payment.orderId ? (await Order.findById(payment.orderId))?.businessIds?.[0] : (await Booking.findById(payment.bookingId))?.businessId);
  const subscriptionPayment = payment.type === 'subscription';
  const promotionPayment = payment.type === 'promotion';
  await createLedgerEntry({ idempotencyKey: `refund:${refund._id}:platform`, accountType: 'platform', accountId: null, businessId, paymentId: payment._id, orderId: payment.orderId, bookingId: payment.bookingId, type: subscriptionPayment ? 'subscription_refund' : promotionPayment ? 'promotion_refund' : 'refund', direction: 'debit', amountMinor: refund.amountMinor, currency: payment.currency, metadata: { refundId: refund._id.toString(), subscriptionId: payment.subscriptionId?.toString() || null, invoiceId: payment.invoiceId?.toString() || null, campaignId: payment.campaignId?.toString() || null } });
  if (!subscriptionPayment && !promotionPayment && businessId) await createLedgerEntry({ idempotencyKey: `refund:${refund._id}:business`, accountType: 'business', accountId: businessId, businessId, paymentId: payment._id, orderId: payment.orderId, bookingId: payment.bookingId, type: 'seller_debit', direction: 'debit', amountMinor: refund.amountMinor, currency: payment.currency, metadata: { refundId: refund._id.toString(), reason: 'transaction_refund' } });
  if (promotionPayment) {
    const { PromotionCampaign } = require('../advertising/promotion-campaign.model');
    const { PromotionFunding } = require('../advertising/promotion-funding.model');
    const funding = await PromotionFunding.findOneAndUpdate({ _id: payment.promotionFundingId, $expr: { $lte: [{ $add: ['$refundedMinor', refund.amountMinor] }, '$amountMinor'] } }, { $inc: { refundedMinor: refund.amountMinor } }, { new: true });
    if (!funding) throw new AppError(409, 'PROMOTION_REFUND_EXCEEDS_UNUSED_BALANCE', 'Only the unused promotion balance can be refunded');
    funding.status = funding.refundedMinor >= funding.amountMinor ? 'refunded' : 'partially_refunded';
    await funding.save();
    await PromotionCampaign.findOneAndUpdate({ _id: payment.campaignId, businessId }, { $inc: { refundedMinor: refund.amountMinor }, $set: funding.refundedMinor >= funding.amountMinor ? { status: 'CANCELLED', cancelledAt: new Date() } : {} });
  }
  await Refund.updateOne({ _id: refund._id }, { $set: { status: 'completed' } });
  if (payment.orderId || payment.bookingId) {
    const refundEvent = payment.orderId ? 'ORDER_REFUNDED' : 'BOOKING_REFUNDED';
    await require('../analytics/domain-event.service').queue(refundEvent, { actorType: 'system', businessId, entityType: payment.orderId ? 'order' : 'booking', entityId: payment.orderId || payment.bookingId, metadata: { paymentId: payment._id.toString(), amountMinor: refund.amountMinor, currency: payment.currency, reason: refund.reason } }, `refund:${refund._id}:analytics`);
  }
  const payout = subscriptionPayment || promotionPayment ? null : await Payout.findOne({ sourcePaymentId: payment._id });
  if (payout) {
    if (payout.status === 'paid' || payout.status === 'processing') {
      payout.holdReason = payout.holdReason || 'Recovery required after refund';
      await payout.save();
    } else if (refund.amountMinor >= payout.amountMinor) {
      payout.status = 'reversed'; payout.holdReason = null; payout.failureReason = 'Reversed after refund'; await payout.save();
    } else {
      payout.amountMinor -= refund.amountMinor;
      if (payout.status === 'held') { payout.status = payout.eligibleAt <= new Date() ? 'eligible' : 'pending'; payout.holdReason = null; }
      await payout.save();
    }
  }
  if (payment.orderId) { const order = await Order.findById(payment.orderId); if (order) { order.paymentStatus = payment.status; if (payment.status === 'refunded') order.status = 'refunded'; order.timeline.push({ status: order.status, actorId: null, note: 'Refund completed.' }); await order.save(); } }
  if (payment.bookingId) { const booking = await Booking.findById(payment.bookingId); if (booking) { booking.paymentStatus = payment.status; if (payment.status === 'refunded') booking.status = 'refunded'; booking.timeline.push({ status: booking.status, actorId: null, note: 'Refund completed.' }); await booking.save(); } }
  if (subscriptionPayment && payment.subscriptionId && payment.status === 'refunded') {
    const { BusinessSubscription } = require('../subscriptions/subscription.model');
    const { SubscriptionInvoice } = require('../subscriptions/subscription-invoice.model');
    const subscription = await BusinessSubscription.findById(payment.subscriptionId);
    if (subscription) {
      subscription.status = 'past_due';
      subscription.gracePeriodEndsAt = new Date();
      subscription.cancelAtPeriodEnd = false;
      await subscription.save();
      await require('../subscriptions/subscription.service').recordEvent(subscription, 'SUBSCRIPTION_PAYMENT_REFUNDED', { refundId: refund._id.toString(), invoiceId: payment.invoiceId?.toString() || null });
    }
    if (payment.invoiceId) await SubscriptionInvoice.updateOne({ _id: payment.invoiceId }, { $set: { status: 'refunded' } });
  }
  try {
    const { createNotification } = require('../notifications/notification.service');
    await createNotification({ deduplicationKey: `refund:${refund._id}:customer`, userId: payment.customerId, type: 'refund_completed', title: 'Refund completed', body: `A refund of ${payment.currency} ${(refund.amountMinor / 100).toLocaleString()} has been completed.`, data: { refundId: refund._id.toString(), paymentId: payment._id.toString(), subscriptionId: payment.subscriptionId?.toString() || null, campaignId: payment.campaignId?.toString() || null } });
  } catch (error) { console.error('Unable to create refund notification:', error.message); }
  try { await require('../audit/audit.service').recordAudit({ actorType: 'system', action: 'REFUND_EXECUTED', targetType: 'refund', targetId: refund._id, businessId, reason: refund.reason, after: refund.toSafeJSON() }); } catch (error) { console.error('Unable to record refund audit event:', error.message); }
  return payment;
}

async function getPayment(userId, paymentId) { const payment = await Payment.findOne({ _id: paymentId, customerId: userId }); if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found'); return payment; }
async function listAdminPayments(query) { const filter = { ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: query.type } : {}) }; const skip = (query.page - 1) * query.limit; const [payments, total] = await Promise.all([Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Payment.countDocuments(filter)]); return { payments: payments.map((payment) => payment.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) }; }

module.exports = { paymentReference, refundNumber, payoutNumber, payloadHash, initializePayment, initializeSubscriptionPayment, initializePromotionPayment, verifyPayment, processPaystackWebhook, requestRefund, completeRefund, getPayment, listAdminPayments, settleSuccessfulPayment, recordSettlementLedger };
