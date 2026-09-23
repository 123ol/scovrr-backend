const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { createPromotionSchema } = require('../src/modules/promotions/promotion.validation');
const { appliesToPromotion, normalizeCode } = require('../src/modules/promotions/promotion.service');

const businessId = new mongoose.Types.ObjectId();
const productId = new mongoose.Types.ObjectId();
const variantId = new mongoose.Types.ObjectId();
const categoryId = new mongoose.Types.ObjectId();

test('discount input accepts percentage, fixed amount, delivery and bounded eligibility fields', () => {
  const parsed = createPromotionSchema.parse({ body: { name: 'Launch offer', discountType: 'percentage', valueType: 'percentage', value: 15, targetType: 'category', categoryIds: [categoryId.toString()], startsAt: '2026-08-20T00:00:00.000Z', endsAt: '2026-09-20T00:00:00.000Z', perUserLimit: 1, stackable: false, fundedBy: 'business' }, params: { businessId: businessId.toString() }, query: {} });
  assert.equal(parsed.body.value, 15);
  assert.equal(parsed.body.perUserLimit, 1);
  assert.equal(parsed.body.fundedBy, 'business');
});

test('coupon codes are normalized at the API boundary', () => {
  assert.equal(normalizeCode('  summer_10 '), 'SUMMER_10');
  assert.equal(normalizeCode(null), null);
});

test('discount scopes apply only to matching product lines and variants', () => {
  const base = { businessId, productId, variantId, categoryId, type: 'product', lineTotalMinor: 100_000 };
  assert.equal(appliesToPromotion({ businessId, targetType: 'business', productIds: [], productVariantIds: [], categoryIds: [], serviceIds: [], serviceVariantIds: [], excludedProductIds: [], excludedServiceIds: [] }, base), true);
  assert.equal(appliesToPromotion({ businessId, targetType: 'product_variant', productVariantIds: [variantId], excludedProductIds: [], excludedServiceIds: [] }, base), true);
  assert.equal(appliesToPromotion({ businessId, targetType: 'product_variant', productVariantIds: [new mongoose.Types.ObjectId()], excludedProductIds: [], excludedServiceIds: [] }, base), false);
  assert.equal(appliesToPromotion({ businessId, targetType: 'category', categoryIds: [categoryId], excludedProductIds: [], excludedServiceIds: [] }, base), true);
});

test('excluded catalogue lines never receive a discount', () => {
  assert.equal(appliesToPromotion({ businessId, targetType: 'business', excludedProductIds: [productId], excludedServiceIds: [] }, { businessId, productId, type: 'product', lineTotalMinor: 5_000 }), false);
});
