const { AppError } = require('../../common/errors/AppError');
const { Business } = require('../businesses/business.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { Conversation } = require('./conversation.model');
const { Message } = require('./message.model');
const { EvidenceAsset } = require('../evidence/evidence-asset.model');
const { assertUserCanActById } = require('../users/user-status.service');

function assertBuyerCanStartConversation(user) {
  if (user?.accountType !== 'buyer') throw new AppError(403, 'BUYER_INITIATED_CONVERSATION_ONLY', 'Only buyers can start new conversations with businesses');
}

function assertSellerCanReply(user, hasBuyerMessage) {
  if (user?.accountType === 'seller' && !hasBuyerMessage) throw new AppError(403, 'BUYER_MESSAGE_REQUIRED', 'A seller can reply only after the buyer has sent a message');
}

function makeConversationKey(participantIds, contextType, contextId) {
  return `${participantIds.map((id) => id.toString()).sort().join(',')}:${contextType}:${contextId?.toString() || 'none'}`;
}

async function resolveContext(userId, input) {
  const business = await Business.findOne({ _id: input.businessId, status: 'active', moderationStatus: 'approved' });
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  let contextSnapshot = { businessId: business._id.toString(), businessName: business.name };
  if (input.contextType === 'product') { const product = await Product.findOne({ _id: input.contextId, businessId: business._id }); if (!product) throw new AppError(404, 'CONTEXT_NOT_FOUND', 'Product context not found'); contextSnapshot = { ...contextSnapshot, productId: product._id.toString(), productName: product.name, priceMinor: product.basePriceMinor, currency: product.currency }; }
  if (input.contextType === 'service') { const service = await Service.findOne({ _id: input.contextId, businessId: business._id }); if (!service) throw new AppError(404, 'CONTEXT_NOT_FOUND', 'Service context not found'); contextSnapshot = { ...contextSnapshot, serviceId: service._id.toString(), serviceName: service.name, priceMinor: service.basePriceMinor, currency: service.currency }; }
  if (input.contextType === 'order') { const order = await Order.findOne({ _id: input.contextId, customerId: userId, businessIds: business._id }); if (!order) throw new AppError(404, 'CONTEXT_NOT_FOUND', 'Order context not found'); contextSnapshot = { ...contextSnapshot, orderId: order._id.toString(), orderNumber: order.orderNumber }; }
  if (input.contextType === 'booking') { const booking = await Booking.findOne({ _id: input.contextId, customerId: userId, businessId: business._id }); if (!booking) throw new AppError(404, 'CONTEXT_NOT_FOUND', 'Booking context not found'); contextSnapshot = { ...contextSnapshot, bookingId: booking._id.toString(), bookingNumber: booking.bookingNumber }; }
  const owner = await BusinessMembership.findOne({ businessId: business._id, role: 'owner', status: 'active' }).select('userId');
  if (!owner || owner.userId.toString() === userId.toString()) throw new AppError(409, 'CONVERSATION_RECIPIENT_UNAVAILABLE', 'This business cannot receive a new conversation');
  return { business, ownerId: owner.userId, contextSnapshot };
}

async function createConversation(userId, input) {
  const user = await assertUserCanActById(userId);
  assertBuyerCanStartConversation(user);
  const context = await resolveContext(userId, input);
  const participantIds = [userId, context.ownerId].sort((a, b) => a.toString().localeCompare(b.toString()));
  const conversationKey = makeConversationKey(participantIds, input.contextType, input.contextId || null);
  let conversation = await Conversation.findOne({ conversationKey });
  if (!conversation) {
    try {
      conversation = await Conversation.create({ participantIds, conversationKey, contextType: input.contextType, contextId: input.contextId || null, contextSnapshot: context.contextSnapshot });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      conversation = await Conversation.findOne({ conversationKey });
    }
  }
  if (input.body) await sendMessage(userId, conversation._id, { type: 'text', body: input.body, media: [] });
  return conversation;
}

async function getConversation(userId, conversationId) { const conversation = await Conversation.findOne({ _id: conversationId, participantIds: userId }); if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found'); return conversation; }
async function listConversations(userId, query) { const skip = (query.page - 1) * query.limit; const filter = { participantIds: userId }; const [items, total] = await Promise.all([Conversation.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(query.limit), Conversation.countDocuments(filter)]); return { conversations: items.map((item) => item.toSafeJSON(userId)), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) }; }
async function listMessages(userId, conversationId, query) { await getConversation(userId, conversationId); const skip = (query.page - 1) * query.limit; const filter = { conversationId }; const [items, total] = await Promise.all([Message.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit), Message.countDocuments(filter)]); return { messages: items.reverse().map((item) => item.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) }; }
async function sendMessage(userId, conversationId, input) {
  const user = await assertUserCanActById(userId);
  const conversation = await getConversation(userId, conversationId);
  const hasBuyerMessage = user.accountType !== 'seller' || Boolean(await Message.exists({ conversationId, senderId: { $ne: userId } }));
  assertSellerCanReply(user, hasBuyerMessage);
  const media = input.media || [];
  const evidenceIds = [...new Set(media.map((item) => item.evidenceId).filter(Boolean).map(String))];
  if (evidenceIds.length) {
    const assets = await EvidenceAsset.find({ _id: { $in: evidenceIds }, purpose: 'message', uploadedBy: userId, contextSubjectType: 'conversation', contextSubjectId: conversationId, status: 'uploaded' }).select('_id');
    if (assets.length !== evidenceIds.length) throw new AppError(403, 'MESSAGE_MEDIA_NOT_AUTHORIZED', 'One or more message attachments are no longer available');
  }
  const message = await Message.create({ conversationId, senderId: userId, type: input.type, body: input.body || '', media, readBy: [userId], deliveredAt: new Date() });
  if (evidenceIds.length) await EvidenceAsset.updateMany({ _id: { $in: evidenceIds }, status: 'uploaded' }, { $set: { subjectType: 'message', subjectId: message._id, status: 'attached', attachedAt: new Date() } });
  conversation.lastMessagePreview = input.body || (media.length ? 'Sent an attachment' : ''); conversation.lastMessageAt = new Date(); await conversation.save(); return { conversation, message };
}
async function markRead(userId, conversationId) { const conversation = await getConversation(userId, conversationId); await Message.updateMany({ conversationId, senderId: { $ne: userId }, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } }); return conversation; }

module.exports = { assertBuyerCanStartConversation, assertSellerCanReply, makeConversationKey, resolveContext, createConversation, getConversation, listConversations, listMessages, sendMessage, markRead };
