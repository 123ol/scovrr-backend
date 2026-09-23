const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const mongoose = require('mongoose');
const { PaystackProvider } = require('../src/integrations/payments/paystack.provider');
const { Payment } = require('../src/modules/payments/payment.model');
const { Review } = require('../src/modules/reviews/review.model');
const { createReviewSchema } = require('../src/modules/reviews/review.validation');
const { sendMessageSchema } = require('../src/modules/conversations/conversation.validation');
const { Conversation } = require('../src/modules/conversations/conversation.model');
const { assertBuyerCanStartConversation, assertSellerCanReply, makeConversationKey } = require('../src/modules/conversations/conversation.service');

test('Paystack webhook signatures are verified against the raw request body', () => {
  const provider = new PaystackProvider('phase5-test-secret');
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'SCV-PAY-TEST' } }));
  const signature = crypto.createHmac('sha512', 'phase5-test-secret').update(body).digest('hex');
  assert.equal(provider.verifyWebhookSignature(signature, body), true);
  assert.equal(provider.verifyWebhookSignature(`${signature.slice(0, -1)}0`, body), false);
});

test('payment records expose authorization details but not internal customer/provider payloads', () => {
  const payment = new Payment({ _id: new mongoose.Types.ObjectId(), reference: 'SCV-PAY-TEST', customerId: new mongoose.Types.ObjectId(), type: 'order', amountMinor: 2500000, currency: 'NGN', authorizationUrl: 'https://checkout.example.test', accessCode: 'access-code', metadata: { customerEmail: 'private@example.com' } });
  const safe = payment.toSafeJSON();
  assert.equal(safe.authorizationUrl, 'https://checkout.example.test');
  assert.equal(safe.accessCode, 'access-code');
  assert.equal('metadata' in safe, false);
  assert.equal('customerId' in safe, false);
});

test('review and message contracts require transaction/context-safe payloads', () => {
  const review = createReviewSchema.safeParse({ body: { targetType: 'product', targetId: '507f1f77bcf86cd799439011', orderId: '507f1f77bcf86cd799439012', rating: 5, text: 'Excellent quality', media: [] }, params: {}, query: {} });
  assert.equal(review.success, true);
  const message = sendMessageSchema.safeParse({ body: { type: 'text', body: 'Is this still available?', media: [] }, params: { conversationId: '507f1f77bcf86cd799439011' }, query: {} });
  assert.equal(message.success, true);
  const invalid = sendMessageSchema.safeParse({ body: { type: 'text', body: '', media: [] }, params: { conversationId: '507f1f77bcf86cd799439011' }, query: {} });
  assert.equal(invalid.success, false);
});

test('only buyer accounts can start new conversations', () => {
  assert.doesNotThrow(() => assertBuyerCanStartConversation({ accountType: 'buyer' }));
  assert.throws(() => assertBuyerCanStartConversation({ accountType: 'seller' }), (error) => error.code === 'BUYER_INITIATED_CONVERSATION_ONLY');
  assert.throws(() => assertSellerCanReply({ accountType: 'seller' }, false), (error) => error.code === 'BUYER_MESSAGE_REQUIRED');
  assert.doesNotThrow(() => assertSellerCanReply({ accountType: 'seller' }, true));
});

test('conversation identity is deterministic and unique for a buyer, seller, and context', () => {
  const buyer = new mongoose.Types.ObjectId();
  const seller = new mongoose.Types.ObjectId();
  assert.equal(makeConversationKey([buyer, seller], 'product', buyer), makeConversationKey([seller, buyer], 'product', buyer));
  assert.ok(Conversation.schema.indexes().some(([fields, options]) => fields.conversationKey && options.unique && options.sparse));
});

test('review indexes are scoped to a completed transaction target', () => {
  const indexes = Review.schema.indexes().map(([fields]) => fields);
  assert.ok(indexes.some((fields) => fields.orderId && fields.productId));
  assert.ok(indexes.some((fields) => fields.bookingId && fields.serviceId));
});
