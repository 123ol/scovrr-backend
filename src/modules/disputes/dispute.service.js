const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { Dispute } = require('./dispute.model');
const { DisputeEvent } = require('./dispute-event.model');
const { OperationalNote } = require('../operations/operational-note.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { User } = require('../users/user.model');
const { Payment } = require('../payments/payment.model');
const { Payout } = require('../payouts/payout.model');
const payoutService = require('../payouts/payout.service');
const paymentService = require('../payments/payment.service');
const { recordAudit } = require('../audit/audit.service');
const { assertUserCanActById } = require('../users/user-status.service');
const { logger } = require('../../common/observability/logger');

const ACTIVE_STATUSES = ['open', 'awaiting_business_response', 'awaiting_customer_response', 'under_review'];
const ORDER_REASONS = new Set(['item_not_received', 'item_not_as_described', 'incorrect_product', 'wrong_item', 'damaged_item', 'missing_item', 'partial_delivery', 'delivery_problem', 'seller_unresponsive', 'refund_not_received', 'payment_issue', 'fraud', 'other']);
const BOOKING_REASONS = new Set(['service_not_delivered', 'service_not_as_described', 'service_quality', 'professional_no_show', 'seller_absent', 'professional_misconduct', 'customer_no_show', 'booking_cancelled_unfairly', 'refund_not_received', 'payment_issue', 'fraud', 'other']);

function disputeNumber() { return `SCV-DSP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function activeKey(type, id) { return `${type}:${id.toString()}`; }
function daysFor(type) { return type === 'order' ? env.disputeOrderWindowDays : env.disputeBookingWindowDays; }

function getCustomerProtectionPolicy() {
  return {
    version: 'local-v1',
    windows: { orderDisputeDays: env.disputeOrderWindowDays, bookingDisputeDays: env.disputeBookingWindowDays, businessResponseDays: env.disputeResponseWindowDays },
    eligibility: { orderStatuses: ['delivered', 'completed'], bookingStatuses: ['completed', 'cancelled_by_business', 'cancelled_by_customer', 'no_show'] },
    evidence: { maxItemsPerDispute: env.disputeMaxEvidenceItems, uploadSessionTtlSeconds: env.evidenceUploadSessionTtlSeconds, signedUrlTtlSeconds: env.evidenceSignedUrlTtlSeconds },
    reasons: { order: [...ORDER_REASONS], booking: [...BOOKING_REASONS] },
    outcomes: ['full_refund', 'partial_refund', 'release_to_business', 'no_financial_action'],
    notes: ['Eligibility is evaluated against the current transaction state and dispute window.', 'Refunds and payout changes require authorized review and provider confirmation; opening a dispute does not guarantee a refund.']
  };
}

async function paymentForTarget(type, targetId) {
  return Payment.findOne(type === 'order' ? { orderId: targetId, status: { $in: ['successful', 'partially_refunded'] } } : { bookingId: targetId, status: { $in: ['successful', 'partially_refunded'] } }).sort({ createdAt: -1 });
}

async function resolveTarget(userId, input) {
  if (!mongoose.isValidObjectId(input.targetId)) throw new AppError(400, 'INVALID_DISPUTE_TARGET', 'The dispute transaction is invalid');
  if (input.targetType === 'order') {
    const order = await Order.findOne({ _id: input.targetId, customerId: userId, paymentStatus: { $in: ['successful', 'partially_refunded'] } });
    if (!order) throw new AppError(404, 'DISPUTE_TARGET_NOT_FOUND', 'The paid order could not be found');
    if (!['delivered', 'completed'].includes(order.status)) throw new AppError(409, 'DISPUTE_NOT_ELIGIBLE', 'This order is not in a dispute-eligible state');
    const completedAt = order.timeline?.find((entry) => ['delivered', 'completed'].includes(entry.status))?.createdAt || order.updatedAt;
    if (completedAt && new Date(completedAt).getTime() + daysFor('order') * 86_400_000 < Date.now()) throw new AppError(409, 'DISPUTE_WINDOW_EXPIRED', 'The order dispute window has expired');
    return { transactionType: 'order', target: order, businessId: order.businessIds[0], payment: await paymentForTarget('order', order._id) };
  }
  const booking = await Booking.findOne({ _id: input.targetId, customerId: userId, paymentStatus: { $in: ['successful', 'partially_refunded'] } });
  if (!booking) throw new AppError(404, 'DISPUTE_TARGET_NOT_FOUND', 'The paid booking could not be found');
  if (!['completed', 'cancelled_by_business', 'cancelled_by_customer', 'no_show'].includes(booking.status)) throw new AppError(409, 'DISPUTE_NOT_ELIGIBLE', 'This booking is not in a dispute-eligible state');
  const completedAt = booking.status === 'completed' ? booking.endAt : booking.updatedAt;
  if (completedAt && new Date(completedAt).getTime() + daysFor('booking') * 86_400_000 < Date.now()) throw new AppError(409, 'DISPUTE_WINDOW_EXPIRED', 'The booking dispute window has expired');
  return { transactionType: 'booking', target: booking, businessId: booking.businessId, payment: await paymentForTarget('booking', booking._id) };
}

async function addEvent(disputeId, type, actorId, actorType, status, note, metadata = {}) {
  return DisputeEvent.create({ disputeId, type, actorId: actorId || null, actorType, status: status || null, note: note || '', metadata });
}

async function holdForDispute(dispute, payment) {
  if (!payment) return { state: 'not_held', payout: null };
  const payout = await Payout.findOne({ sourcePaymentId: payment._id });
  if (!payout) return { state: 'not_held', payout: null };
  const result = await payoutService.holdPayoutForDispute(payout._id, dispute.disputeNumber, 'Customer dispute');
  return { state: result.state, payout: result.payout };
}

async function createDispute(userId, input) {
  await assertUserCanActById(userId);
  const target = await resolveTarget(userId, input);
  const reasonSet = target.transactionType === 'order' ? ORDER_REASONS : BOOKING_REASONS;
  if (!reasonSet.has(input.reason)) throw new AppError(400, 'INVALID_DISPUTE_REASON', 'This reason is not valid for the selected transaction');
  const key = activeKey(target.transactionType, input.targetId);
  const existing = await Dispute.findOne({ activeTransactionKey: key, status: { $in: ACTIVE_STATUSES } });
  if (existing) throw new AppError(409, 'DISPUTE_ALREADY_OPEN', 'There is already an open dispute for this transaction');
  const payment = target.payment;
  const amountMinor = payment?.amountMinor || target.target.totalMinor || target.target.priceMinor;
  let dispute;
  try {
  dispute = await Dispute.create({ disputeNumber: disputeNumber(), activeTransactionKey: key, customerId: userId, businessId: target.businessId, targetType: target.transactionType, transactionType: target.transactionType, orderId: target.transactionType === 'order' ? input.targetId : null, bookingId: target.transactionType === 'booking' ? input.targetId : null, reason: input.reason, description: input.description, disputedAmountMinor: amountMinor, currency: payment?.currency || target.target.currency, status: 'open', openedAt: new Date(), responseDeadline: new Date(Date.now() + env.disputeResponseWindowDays * 86_400_000), financialState: 'not_held', financialHold: false });
  if (input.evidenceAssetIds?.length) {
    const { attachEvidence } = require('../evidence/evidence.service');
    dispute.evidence = await attachEvidence({ userId, purpose: 'dispute', subject: { id: dispute._id, subjectId: dispute._id }, evidenceAssetIds: input.evidenceAssetIds });
  }
  } catch (error) {
    if (error?.code === 11000) throw new AppError(409, 'DISPUTE_ALREADY_OPEN', 'There is already an open dispute for this transaction');
    throw error;
  }
  const hold = await holdForDispute(dispute, payment);
  dispute.financialState = hold.state;
  dispute.financialHold = hold.state === 'held';
  dispute.payoutId = hold.payout?._id || null;
  await dispute.save();
  await addEvent(dispute._id, 'DISPUTE_OPENED', userId, 'user', dispute.status, 'Customer opened a transaction dispute.');
  if (hold.state === 'held') { await addEvent(dispute._id, 'PAYOUT_HELD', null, 'system', dispute.status, 'The related payout was held while the dispute is reviewed.', { payoutId: hold.payout._id.toString() }); await recordAudit({ actorType: 'system', action: 'PAYOUT_HELD', targetType: 'payout', targetId: hold.payout._id, businessId: target.businessId, reason: `Dispute ${dispute.disputeNumber}`, after: hold.payout.toSafeJSON() }); }
  if (hold.state === 'recovery_required') await addEvent(dispute._id, 'PAYOUT_RECOVERY_REQUIRED', null, 'system', dispute.status, 'The related payout was already paid and requires Finance review.', { payoutId: hold.payout._id.toString() });
  try {
    const { createNotification } = require('../notifications/notification.service');
    const owner = await BusinessMembership.findOne({ businessId: target.businessId, role: 'owner', status: 'active' }).select('userId');
    if (owner) await createNotification({ deduplicationKey: `dispute:${dispute._id}:business-opened`, userId: owner.userId, type: 'dispute_opened', title: 'New transaction dispute', body: `A customer opened dispute ${dispute.disputeNumber}.`, data: { disputeId: dispute._id.toString(), businessId: target.businessId.toString() } });
  } catch (error) { logger.error('dispute.business_notification.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
  return dispute;
}

async function getCustomerDispute(userId, disputeId) {
  const dispute = await Dispute.findOne({ _id: disputeId, customerId: userId });
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  const events = await DisputeEvent.find({ disputeId }).sort({ createdAt: 1 }).limit(100);
  return { dispute, events };
}

async function listCustomerDisputes(userId, query) {
  const filter = { customerId: userId, ...(query.status ? { status: query.status } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [disputes, total] = await Promise.all([Dispute.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Dispute.countDocuments(filter)]);
  return { disputes: disputes.map((dispute) => dispute.toSafeJSON({ audience: 'customer' })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function listBusinessDisputes(businessId, query) {
  const filter = { businessId, ...(query.status ? { status: query.status } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [disputes, total] = await Promise.all([Dispute.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Dispute.countDocuments(filter)]);
  return { disputes: disputes.map((dispute) => dispute.toSafeJSON({ audience: 'business' })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getBusinessDispute(businessId, disputeId) {
  const dispute = await Dispute.findOne({ _id: disputeId, businessId });
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  const events = await DisputeEvent.find({ disputeId }).sort({ createdAt: 1 }).limit(100);
  return { dispute, events };
}

async function respondAsBusiness(businessId, userId, disputeId, input) {
  await assertUserCanActById(userId);
  const membership = await BusinessMembership.findOne({ businessId, userId, status: 'active' });
  if (!membership || (membership.role !== 'owner' && !membership.permissions.some((permission) => ['customers.manage', 'orders.manage', 'bookings.manage', '*'].includes(permission)))) throw new AppError(403, 'BUSINESS_PERMISSION_REQUIRED', 'You do not have permission to respond to disputes');
  const dispute = await Dispute.findOne({ _id: disputeId, businessId, status: { $in: ACTIVE_STATUSES } });
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  let evidence = [];
  if (input.evidenceAssetIds?.length) {
    const { attachEvidence } = require('../evidence/evidence.service');
    evidence = await attachEvidence({ userId, purpose: 'dispute', subject: { id: dispute._id, subjectId: dispute._id }, evidenceAssetIds: input.evidenceAssetIds });
  }
  dispute.businessResponse = { description: input.description, evidence, proposedResolution: input.proposedResolution || null, respondedBy: userId, respondedAt: new Date() };
  dispute.status = 'under_review';
  await dispute.save();
  await addEvent(dispute._id, 'BUSINESS_RESPONDED', userId, 'business', dispute.status, 'Business submitted a response.');
  if (evidence.length) await addEvent(dispute._id, 'BUSINESS_EVIDENCE_ADDED', userId, 'business', dispute.status, 'Business attached evidence to the dispute.', { evidenceIds: evidence.map((item) => item.evidenceId.toString()) });
  try {
    const { createNotification } = require('../notifications/notification.service');
    await createNotification({ deduplicationKey: `dispute:${dispute._id}:business-response:${dispute.updatedAt.getTime()}`, userId: dispute.customerId, type: 'dispute_business_responded', title: 'Business responded to your dispute', body: `The business responded to dispute ${dispute.disputeNumber}.`, data: { disputeId: dispute._id.toString() } });
  } catch (error) { logger.error('dispute.response_notification.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
  return dispute;
}

async function addCustomerEvidence(userId, disputeId, evidenceAssetIds) {
  await assertUserCanActById(userId);
  const dispute = await Dispute.findOne({ _id: disputeId, customerId: userId, status: { $in: ACTIVE_STATUSES } });
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found or no longer accepts evidence');
  const { attachEvidence } = require('../evidence/evidence.service');
  const snapshots = await attachEvidence({ userId, purpose: 'dispute', subject: { id: dispute._id, subjectId: dispute._id }, evidenceAssetIds });
  dispute.evidence.push(...snapshots); await dispute.save();
  await addEvent(dispute._id, 'CUSTOMER_EVIDENCE_ADDED', userId, 'user', dispute.status, 'Customer attached evidence to the dispute.', { evidenceIds: snapshots.map((item) => item.evidenceId.toString()) });
  return dispute;
}

async function listAdminDisputes(query) {
  const filter = { ...(query.status ? { status: query.status } : {}), ...(query.transactionType ? { transactionType: query.transactionType } : {}), ...(query.reason ? { reason: query.reason } : {}), ...(query.businessId ? { businessId: query.businessId } : {}), ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}), ...((query.from || query.to) ? { createdAt: { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lt: new Date(query.to) } : {}) } } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [disputes, total] = await Promise.all([Dispute.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).populate('customerId', 'firstName lastName email').populate('businessId', 'name slug'), Dispute.countDocuments(filter)]);
  return { disputes: disputes.map((dispute) => ({ ...dispute.toSafeJSON({ audience: 'admin' }), customer: dispute.customerId?.email ? { id: dispute.customerId._id.toString(), firstName: dispute.customerId.firstName, lastName: dispute.customerId.lastName, email: dispute.customerId.email } : null, business: dispute.businessId?.name ? { id: dispute.businessId._id.toString(), name: dispute.businessId.name, slug: dispute.businessId.slug } : null })), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

async function getAdminDispute(disputeId) {
  const dispute = await Dispute.findById(disputeId).populate('customerId', 'firstName lastName email').populate('businessId', 'name slug').populate('assignedAdminId', 'firstName lastName email');
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  const [events, notes, payment] = await Promise.all([DisputeEvent.find({ disputeId }).sort({ createdAt: 1 }).limit(200), OperationalNote.find({ subjectType: 'dispute', subjectId: dispute._id }).sort({ createdAt: -1 }).limit(100).populate('authorAdminId', 'firstName lastName email'), paymentForTarget(dispute.transactionType || dispute.targetType, dispute.orderId || dispute.bookingId)]);
  return { dispute, events, notes, payment };
}

async function assignDispute(disputeId, adminId, assignedAdminId = adminId) {
  const assignee = await User.findOne({ _id: assignedAdminId, status: 'active', adminRoles: { $exists: true, $ne: [] } }).select('_id');
  if (!assignee) throw new AppError(400, 'INVALID_DISPUTE_ASSIGNEE', 'Disputes can only be assigned to active administrators');
  const dispute = await Dispute.findOne({ _id: disputeId, status: { $in: ACTIVE_STATUSES } });
  if (!dispute) throw new AppError(409, 'DISPUTE_NOT_ASSIGNABLE', 'This dispute is not available for assignment');
  dispute.assignedAdminId = assignedAdminId; if (dispute.status === 'open') dispute.status = 'under_review'; await dispute.save();
  await addEvent(dispute._id, 'ADMIN_ASSIGNED', adminId, 'admin', dispute.status, 'Dispute assigned for review.');
  return dispute;
}

async function beginReview(disputeId, adminId, note = '') {
  const dispute = await Dispute.findOne({ _id: disputeId, status: { $in: ['open', 'awaiting_business_response', 'awaiting_customer_response'] } });
  if (!dispute) throw new AppError(409, 'DISPUTE_NOT_REVIEWABLE', 'This dispute is not available to begin review');
  dispute.status = 'under_review'; dispute.assignedAdminId = dispute.assignedAdminId || adminId; await dispute.save(); await addEvent(dispute._id, 'ADMIN_REVIEW_STARTED', adminId, 'admin', dispute.status, note); return dispute;
}

async function resolveDispute(disputeId, adminId, input) {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  const outcome = { refund_full: 'full_refund', refund_partial: 'partial_refund', no_refund: 'no_financial_action', full_refund: 'full_refund', partial_refund: 'partial_refund', release_to_business: 'release_to_business', no_financial_action: 'no_financial_action' }[input.outcome];
  if (!outcome) throw new AppError(400, 'INVALID_DISPUTE_RESOLUTION', 'This dispute resolution is not supported');
  if (!ACTIVE_STATUSES.includes(dispute.status)) {
    if (dispute.resolution?.type === outcome) return dispute;
    throw new AppError(409, 'DISPUTE_CLOSED', 'This dispute has already been resolved');
  }
  const payment = await paymentForTarget(dispute.transactionType || dispute.targetType, dispute.orderId || dispute.bookingId);
  let refund = null;
  if (outcome === 'full_refund' || outcome === 'partial_refund') {
    if (!payment) throw new AppError(409, 'DISPUTE_PAYMENT_NOT_FOUND', 'The payment for this dispute could not be found');
    const amountMinor = outcome === 'full_refund' ? payment.amountMinor - payment.refundedAmountMinor : input.amountMinor;
    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > payment.amountMinor - payment.refundedAmountMinor) throw new AppError(400, 'INVALID_REFUND_AMOUNT', 'The refund amount is outside the refundable balance');
    refund = await paymentService.requestRefund(adminId, payment._id, { amountMinor, reason: input.note, idempotencyKey: `dispute:${dispute._id}:refund:${amountMinor}` });
    if (refund.status !== 'completed') throw new AppError(409, 'REFUND_PROCESSING', 'The provider is still processing this refund; the dispute remains under review');
    const refundedPayout = dispute.payoutId ? await Payout.findById(dispute.payoutId).select('status') : null;
    dispute.financialState = refundedPayout?.status === 'paid' || refundedPayout?.status === 'processing' ? 'recovery_required' : 'released';
  } else if (dispute.payoutId) {
    const payout = await Payout.findById(dispute.payoutId);
    if (payout?.status === 'held') {
      const releasedPayout = await payoutService.releasePayoutForDispute(dispute.payoutId, dispute.disputeNumber);
      dispute.financialState = 'released'; dispute.financialHold = false;
      await addEvent(dispute._id, 'PAYOUT_RELEASED', adminId, 'admin', 'resolved_business', 'Held payout released after dispute resolution.');
      if (releasedPayout) await recordAudit({ actorId: adminId, action: 'PAYOUT_RELEASED', targetType: 'payout', targetId: releasedPayout._id, businessId: dispute.businessId, reason: input.note, after: releasedPayout.toSafeJSON() });
    } else if (['paid', 'processing'].includes(payout?.status)) {
      dispute.financialState = 'recovery_required'; dispute.financialHold = false;
    }
  }
  dispute.status = outcome === 'full_refund' || outcome === 'partial_refund' ? (outcome === 'partial_refund' ? 'partial_resolution' : 'resolved_customer') : outcome === 'release_to_business' ? 'resolved_business' : 'resolved_business';
  dispute.activeTransactionKey = null;
  dispute.resolvedAt = new Date();
  dispute.closedAt = new Date();
  dispute.financialHold = false;
  dispute.resolution = { type: outcome, amountMinor: refund?.amountMinor || null, refundId: refund?._id || null, note: input.note };
  dispute.adminDecision = { outcome: outcome === 'full_refund' ? 'refund_full' : outcome === 'partial_refund' ? 'refund_partial' : 'no_refund', note: input.note, decidedBy: adminId, decidedAt: new Date() };
  await dispute.save();
  await addEvent(dispute._id, outcome === 'full_refund' ? 'REFUND_APPROVED' : outcome === 'partial_refund' ? 'PARTIAL_REFUND_APPROVED' : outcome === 'release_to_business' ? 'PAYOUT_RELEASED' : 'DISPUTE_RESOLVED', adminId, 'admin', dispute.status, input.note, refund ? { refundId: refund._id.toString(), amountMinor: refund.amountMinor } : {});
  try {
    const { createNotification } = require('../notifications/notification.service');
    await createNotification({ deduplicationKey: `dispute:${dispute._id}:resolved`, userId: dispute.customerId, type: 'dispute_resolved', title: 'Dispute resolved', body: `SCOVRR resolved dispute ${dispute.disputeNumber}.`, data: { disputeId: dispute._id.toString(), outcome } });
    const owner = await BusinessMembership.findOne({ businessId: dispute.businessId, role: 'owner', status: 'active' }).select('userId');
    if (owner) await createNotification({ deduplicationKey: `dispute:${dispute._id}:business-resolved`, userId: owner.userId, type: outcome === 'release_to_business' ? 'payout_released' : 'dispute_resolved', title: 'Dispute resolved', body: `SCOVRR resolved dispute ${dispute.disputeNumber}.`, data: { disputeId: dispute._id.toString(), outcome, financialState: dispute.financialState } });
  } catch (error) { logger.error('dispute.resolution_notification.failed', { error: { name: error.name, code: error.code, message: error.message } }); }
  return dispute;
}

async function addNote(adminId, disputeId, body) {
  if (!await Dispute.exists({ _id: disputeId })) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  return OperationalNote.create({ subjectType: 'dispute', subjectId: disputeId, authorAdminId: adminId, body });
}

module.exports = { disputeNumber, createDispute, getCustomerDispute, listCustomerDisputes, getBusinessDispute, listBusinessDisputes, respondAsBusiness, addCustomerEvidence, listAdminDisputes, getAdminDispute, assignDispute, beginReview, resolveDispute, addNote, addEvent, resolveTarget, getCustomerProtectionPolicy };
