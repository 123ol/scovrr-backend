const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const { PromotionCampaign } = require('../src/modules/advertising/promotion-campaign.model');
const { PromotionFunding } = require('../src/modules/advertising/promotion-funding.model');
const { Payment } = require('../src/modules/payments/payment.model');
const { createPlacementToken, verifyPlacementToken } = require('../src/modules/advertising/promotion-event.service');
const { isPlacementAllowed } = require('../src/modules/advertising/promotion-placement');
const { ENTITLEMENTS, INITIAL_PLAN_ENTITLEMENTS } = require('../src/modules/subscriptions/entitlement-registry');

test('paid promotion domain is separate from discount promotions and uses bounded campaign states', () => {
  const id = new mongoose.Types.ObjectId();
  const campaign = new PromotionCampaign({ _id: id, campaignNumber: 'SCV-AD-TEST', businessId: id, targetType: 'PRODUCT', targetId: id, name: 'Launch edit', objective: 'traffic', startAt: new Date('2026-08-20T00:00:00Z'), endAt: new Date('2026-08-30T00:00:00Z'), currency: 'NGN', budgetMinor: 10000, fundedMinor: 10000, placements: ['PRODUCT_DISCOVERY'] });
  assert.equal(campaign.toSafeJSON().remainingMinor, 10000);
  assert.equal(PromotionCampaign.schema.path('status').enumValues.includes('ACTIVE'), true);
  assert.equal(PromotionCampaign.schema.path('status').enumValues.includes('whatever'), false);
  assert.ok(PromotionCampaign.schema.indexes().some(([fields]) => fields.status && fields.startAt && fields.targetType));
});

test('promotion placement compatibility rejects cross-domain ad slots', () => {
  assert.equal(isPlacementAllowed('PRODUCT', 'PRODUCT_DISCOVERY'), true);
  assert.equal(isPlacementAllowed('PRODUCT', 'SERVICE_DISCOVERY'), false);
  assert.equal(isPlacementAllowed('SERVICE', 'BUSINESS_DISCOVERY'), false);
});

test('promotion event tokens are encrypted, short-lived, and tamper resistant', () => {
  const token = createPlacementToken({ campaignId: new mongoose.Types.ObjectId().toString(), targetType: 'PRODUCT', targetId: new mongoose.Types.ObjectId().toString(), placement: 'PRODUCT_DISCOVERY' }, 30);
  const decoded = verifyPlacementToken(token);
  assert.equal(decoded.targetType, 'PRODUCT');
  const parts = token.split('.');
  parts[3] = `${parts[3].slice(0, -2)}aa`;
  assert.throws(() => verifyPlacementToken(parts.join('.')), (error) => error.code === 'INVALID_PROMOTION_EVENT_TOKEN');
});

test('promotion funding is a payment type but never a seller payout target', () => {
  const id = new mongoose.Types.ObjectId();
  const funding = new PromotionFunding({ campaignId: id, businessId: id, idempotencyKey: 'promotion-funding-test', amountMinor: 10000, currency: 'NGN' });
  const payment = new Payment({ reference: 'SCV-PAY-AD-TEST', type: 'promotion', customerId: id, businessId: id, campaignId: id, promotionFundingId: funding._id, amountMinor: 10000, currency: 'NGN' });
  assert.equal(payment.toSafeJSON().type, 'promotion');
  assert.equal(payment.toSafeJSON().campaignId, id.toString());
  assert.equal(Payment.schema.path('type').enumValues.includes('promotion'), true);
  assert.equal(Payment.schema.path('type').enumValues.includes('payout'), false);
});

test('promotion entitlements define feature, active count, and monthly spend limits', () => {
  assert.equal(INITIAL_PLAN_ENTITLEMENTS.FREE[ENTITLEMENTS.PROMOTIONS_ENABLED], false);
  assert.equal(INITIAL_PLAN_ENTITLEMENTS.PRO[ENTITLEMENTS.ACTIVE_PROMOTIONS_MAX], 3);
  assert.equal(INITIAL_PLAN_ENTITLEMENTS.BUSINESS_PLUS[ENTITLEMENTS.MONTHLY_PROMOTION_SPEND_MAX], null);
});
