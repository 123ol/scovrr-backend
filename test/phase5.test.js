const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const mongoose = require('mongoose');
const { PaystackProvider } = require('../src/integrations/payments/paystack.provider');
const { Payment } = require('../src/modules/payments/payment.model');
const { Review } = require('../src/modules/reviews/review.model');
const { createReviewSchema } = require('../src/modules/reviews/review.validation');
const { sendMessageSchema, messageSearchSchema, archiveSchema, conversationEscalationSchema } = require('../src/modules/conversations/conversation.validation');
const { Conversation } = require('../src/modules/conversations/conversation.model');
const { assertBuyerCanStartConversation, assertSellerCanReply, makeConversationKey, activeSupportEscalationFilter, MESSAGE_CONVERSATION_RATE_LIMIT, MESSAGE_ACCOUNT_RATE_LIMIT } = require('../src/modules/conversations/conversation.service');
const { Business } = require('../src/modules/businesses/business.model');
const { storefrontUpdateSchema, messagingUpdateSchema, listAdminBusinessesSchema } = require('../src/modules/businesses/business.validation');
const { businessAdminFilter } = require('../src/modules/businesses/business.service');
const businessRiskService = require('../src/modules/businesses/business-risk.service');
const { bulkUpdateProductSchema, bulkCreateProductSchema, bulkCsvProductSchema } = require('../src/modules/products/product.validation');
const productService = require('../src/modules/products/product.service');

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

test('message conversations expose a bounded sender rate-control boundary', () => {
  assert.equal(MESSAGE_CONVERSATION_RATE_LIMIT, 20);
  assert.equal(MESSAGE_ACCOUNT_RATE_LIMIT, 60);
  assert.match(require('node:fs').readFileSync(require.resolve('../src/modules/conversations/conversation.service'), 'utf8'), /MESSAGE_RATE_LIMIT/);
  assert.ok(require('../src/modules/conversations/message.model').Message.schema.indexes().some(([fields]) => fields.senderId && fields.createdAt));
});

test('conversation search, filters, and archive contracts are bounded and explicit', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.equal(messageSearchSchema.safeParse({ body: {}, params: {}, query: { q: 'order', page: '1', limit: '20', contextType: 'order' } }).success, true);
  assert.equal(archiveSchema.safeParse({ body: { archived: true }, params: { conversationId: id }, query: {} }).success, true);
  assert.equal(typeof require('../src/modules/conversations/conversation.service').searchMessages, 'function');
  assert.equal(typeof require('../src/modules/conversations/conversation.service').archiveConversation, 'function');
  assert.equal(typeof require('../src/modules/conversations/conversation.service').escalateConversation, 'function');
  assert.equal(conversationEscalationSchema.safeParse({ body: { details: 'I need help with this conversation' }, params: { conversationId: id }, query: {} }).success, true);
  assert.equal(conversationEscalationSchema.safeParse({ body: { details: 'help' }, params: { conversationId: id }, query: {} }).success, false);
  const supportFilter = activeSupportEscalationFilter(new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId());
  assert.deepEqual(supportFilter.status.$in, ['open', 'in_review', 'action_required']);
  assert.equal(supportFilter.reason, 'support_escalation');
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

test('storefront settings stay inside the existing business and expose safe public fields', () => {
  const businessId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const input = storefrontUpdateSchema.safeParse({ body: { bannerUrl: '', bannerTitle: 'Fresh arrivals', bannerSubtitle: '', layout: 'catalogue_first', status: 'open', statusMessage: '', announcementTitle: '', announcementBody: '', announcementExpiresAt: null, featuredProductIds: [productId.toString()], featuredServiceIds: [], faqs: [{ question: 'Do you deliver?', answer: 'Yes', order: 0 }], policies: { delivery: 'Lagos delivery available.', returns: '', cancellations: '' } }, params: { businessId: businessId.toString() }, query: {} });
  assert.equal(input.success, true);
  const business = new Business({ _id: businessId, ownerId: new mongoose.Types.ObjectId(), name: 'Storefront test', slug: 'storefront-test', capabilities: ['marketplace'], operatingModel: 'online_only', storefront: input.data.body });
  const publicBusiness = business.toPublicJSON();
  assert.equal(publicBusiness.storefront.bannerTitle, 'Fresh arrivals');
  assert.equal(publicBusiness.storefront.layout, 'catalogue_first');
  assert.deepEqual(publicBusiness.storefront.featuredProductIds, [productId.toString()]);
  assert.equal(publicBusiness.storefront.policies.delivery, 'Lagos delivery available.');
  assert.equal('verification' in publicBusiness, false);
});

test('business verification levels only become public after approval', () => {
  assert.deepEqual(Business.schema.path('verification.level').enumValues, ['basic', 'verified', 'enhanced']);
  const business = new Business({ _id: new mongoose.Types.ObjectId(), ownerId: new mongoose.Types.ObjectId(), name: 'Verification test', slug: 'verification-test', capabilities: ['services'], operatingModel: 'online_only', verification: { status: 'submitted', level: 'verified' } });
  assert.equal(business.toPublicJSON().verifiedBadge, false);
  business.verification.status = 'approved';
  assert.equal(business.toPublicJSON().verifiedBadge, true);
  assert.equal(business.toPublicJSON().verificationLevel, 'verified');
});

test('admin business search is bounded and composes review filters', () => {
  const parsed = listAdminBusinessesSchema.safeParse({ body: {}, params: {}, query: { search: 'tailor', status: 'active', operatingModel: 'home_based', verificationStatus: 'approved', moderationStatus: 'approved', capability: 'services', page: '1', limit: '25' } });
  assert.equal(parsed.success, true);
  const filter = businessAdminFilter(parsed.data.query);
  assert.equal(filter.status, 'active');
  assert.equal(filter.operatingModel, 'home_based');
  assert.equal(filter['verification.status'], 'approved');
  assert.equal(filter.moderationStatus, 'approved');
  assert.equal(filter.capabilities, 'services');
  assert.equal(filter.$or.length, 3);
  assert.equal(businessAdminFilter({ search: '.*' }).$or[0].name.source, '\\.\\*');
});

test('seller greeting settings are validated and kept out of public business data', () => {
  const businessId = new mongoose.Types.ObjectId();
  const input = messagingUpdateSchema.safeParse({ body: { greetingEnabled: true, greetingText: 'Thanks for reaching out. How can we help?', quickReplyTemplates: ['Is this available?', 'What sizes do you have?'] }, params: { businessId: businessId.toString() }, query: {} });
  assert.equal(input.success, true);
  const business = new Business({ _id: businessId, ownerId: new mongoose.Types.ObjectId(), name: 'Greeting test', slug: 'greeting-test', capabilities: ['services'], operatingModel: 'online_only', messaging: input.data.body });
  assert.equal(business.toOwnerJSON().messaging.greetingEnabled, true);
  assert.deepEqual(business.toOwnerJSON().messaging.quickReplyTemplates, ['Is this available?', 'What sizes do you have?']);
  assert.equal(messagingUpdateSchema.safeParse({ body: { quickReplyTemplates: [''] }, params: { businessId: businessId.toString() }, query: {} }).success, false);
  assert.equal('messaging' in business.toPublicJSON(), false);
});

test('admin seller-risk monitoring has bounded report, dispute, and payment-review signals', () => {
  assert.equal(typeof businessRiskService.listRiskSignals, 'function');
  const profile = businessRiskService.calculateRiskProfile({ report: { reports: 2, highPriorityReports: 1 }, dispute: { disputes: 1 }, payment: { paymentReviews: 1, highestPaymentRisk: 80 }, repeat: { repeatReporters: 1, repeatDisputeCustomers: 1 } });
  assert.equal(profile.riskBand, 'high');
  assert.equal(profile.score, 91);
  assert.equal(businessRiskService.calculateRiskProfile({ review: { coordinatedReviewers: 1, reviewBurstCount: 1 } }).score, 11);
  const low = businessRiskService.calculateRiskProfile();
  assert.deepEqual(low, { score: 0, riskBand: 'low' });
});

test('bulk product editing is bounded and reuses the existing product update path', () => {
  const parsed = bulkUpdateProductSchema.safeParse({ body: { updates: [{ productId: '507f1f77bcf86cd799439011', patch: { lowStockThreshold: 3, tags: ['new arrival'] } }] }, params: { businessId: '507f1f77bcf86cd799439012' }, query: {} });
  assert.equal(parsed.success, true);
  assert.equal(typeof productService.bulkUpdateProducts, 'function');
  const upload = bulkCreateProductSchema.safeParse({ body: { commit: false, products: [{ name: 'Bulk draft', basePriceMinor: 1000, currency: 'NGN', media: [], variants: [] }] }, params: { businessId: '507f1f77bcf86cd799439012' }, query: {} });
  assert.equal(upload.success, true);
  assert.equal(typeof productService.bulkCreateProductDrafts, 'function');
});

test('CSV product drafts reuse the existing product validation and explicit commit boundary', () => {
  const request = bulkCsvProductSchema.safeParse({ body: { commit: false, csv: 'name,price,currency,stock,tags\n"Lace, Dress","35,000",NGN,2,"dress|new arrival"' }, params: { businessId: '507f1f77bcf86cd799439012' }, query: {} });
  assert.equal(request.success, true);
  const products = productService.parseCsvProductDrafts(request.data.body.csv);
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Lace, Dress');
  assert.equal(products[0].basePriceMinor, 3500000);
  assert.deepEqual(products[0].tags, ['dress', 'new arrival']);
  assert.throws(() => productService.parseCsvProductDrafts('name,price\nOnly name'), (error) => error.code === 'INVALID_PRODUCT_CSV');
  assert.equal(typeof productService.parseCsvProductDrafts, 'function');
});
