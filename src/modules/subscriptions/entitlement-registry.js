const ENTITLEMENT_TYPES = Object.freeze({
  BOOLEAN: 'boolean',
  INTEGER_LIMIT: 'integer_limit'
});

const ENTITLEMENTS = Object.freeze({
  MARKETPLACE_ENABLED: 'marketplace.enabled',
  SERVICES_ENABLED: 'services.enabled',
  PRODUCTS_MAX: 'commerce.products.max',
  SERVICES_MAX: 'commerce.services.max',
  STAFF_MAX: 'business.staff.max',
  LOCATIONS_MAX: 'business.locations.max',
  DISCOUNTS_ENABLED: 'commerce.discounts.enabled',
  ACTIVE_DISCOUNTS_MAX: 'commerce.discounts.active.max',
  COUPONS_ENABLED: 'commerce.coupons.enabled',
  ADVANCED_INVENTORY_ENABLED: 'commerce.inventory.advanced.enabled',
  ADVANCED_ANALYTICS_ENABLED: 'analytics.advanced.enabled',
  PROMOTIONS_ENABLED: 'growth.promotions.enabled',
  ACTIVE_PROMOTIONS_MAX: 'growth.promotions.active.max',
  MONTHLY_PROMOTION_SPEND_MAX: 'growth.promotions.monthlySpend.max',
  PRIORITY_SUPPORT_ENABLED: 'support.priority.enabled',
  MULTIPLE_LOCATIONS_ENABLED: 'business.multiple_locations.enabled',
  CUSTOM_PROFILE_ENABLED: 'business.profile.custom.enabled',
  CUSTOMER_INSIGHTS_ENABLED: 'analytics.customer_insights.enabled',
  SCHEDULED_DISCOUNTS_ENABLED: 'commerce.discounts.scheduled.enabled'
});

// Bootstrap defaults are deliberately editable through PlanVersion records before launch.
const INITIAL_PLAN_ENTITLEMENTS = Object.freeze({
  FREE: Object.freeze({
    [ENTITLEMENTS.MARKETPLACE_ENABLED]: true,
    [ENTITLEMENTS.SERVICES_ENABLED]: true,
    [ENTITLEMENTS.PRODUCTS_MAX]: 25,
    [ENTITLEMENTS.SERVICES_MAX]: 10,
    [ENTITLEMENTS.STAFF_MAX]: 2,
    [ENTITLEMENTS.LOCATIONS_MAX]: 1,
    [ENTITLEMENTS.DISCOUNTS_ENABLED]: true,
    [ENTITLEMENTS.ACTIVE_DISCOUNTS_MAX]: 2,
    [ENTITLEMENTS.COUPONS_ENABLED]: true,
    [ENTITLEMENTS.ADVANCED_INVENTORY_ENABLED]: false,
    [ENTITLEMENTS.ADVANCED_ANALYTICS_ENABLED]: false,
    [ENTITLEMENTS.PROMOTIONS_ENABLED]: false,
    [ENTITLEMENTS.ACTIVE_PROMOTIONS_MAX]: 0,
    [ENTITLEMENTS.MONTHLY_PROMOTION_SPEND_MAX]: 0,
    [ENTITLEMENTS.PRIORITY_SUPPORT_ENABLED]: false,
    [ENTITLEMENTS.MULTIPLE_LOCATIONS_ENABLED]: false,
    [ENTITLEMENTS.CUSTOM_PROFILE_ENABLED]: false,
    [ENTITLEMENTS.CUSTOMER_INSIGHTS_ENABLED]: false,
    [ENTITLEMENTS.SCHEDULED_DISCOUNTS_ENABLED]: false
  }),
  PRO: Object.freeze({
    [ENTITLEMENTS.MARKETPLACE_ENABLED]: true,
    [ENTITLEMENTS.SERVICES_ENABLED]: true,
    [ENTITLEMENTS.PRODUCTS_MAX]: 500,
    [ENTITLEMENTS.SERVICES_MAX]: 100,
    [ENTITLEMENTS.STAFF_MAX]: 10,
    [ENTITLEMENTS.LOCATIONS_MAX]: 3,
    [ENTITLEMENTS.DISCOUNTS_ENABLED]: true,
    [ENTITLEMENTS.ACTIVE_DISCOUNTS_MAX]: 20,
    [ENTITLEMENTS.COUPONS_ENABLED]: true,
    [ENTITLEMENTS.ADVANCED_INVENTORY_ENABLED]: true,
    [ENTITLEMENTS.ADVANCED_ANALYTICS_ENABLED]: true,
    [ENTITLEMENTS.PROMOTIONS_ENABLED]: true,
    [ENTITLEMENTS.ACTIVE_PROMOTIONS_MAX]: 3,
    [ENTITLEMENTS.MONTHLY_PROMOTION_SPEND_MAX]: 20_000_000,
    [ENTITLEMENTS.PRIORITY_SUPPORT_ENABLED]: false,
    [ENTITLEMENTS.MULTIPLE_LOCATIONS_ENABLED]: true,
    [ENTITLEMENTS.CUSTOM_PROFILE_ENABLED]: true,
    [ENTITLEMENTS.CUSTOMER_INSIGHTS_ENABLED]: true,
    [ENTITLEMENTS.SCHEDULED_DISCOUNTS_ENABLED]: true
  }),
  BUSINESS_PLUS: Object.freeze({
    [ENTITLEMENTS.MARKETPLACE_ENABLED]: true,
    [ENTITLEMENTS.SERVICES_ENABLED]: true,
    [ENTITLEMENTS.PRODUCTS_MAX]: null,
    [ENTITLEMENTS.SERVICES_MAX]: null,
    [ENTITLEMENTS.STAFF_MAX]: null,
    [ENTITLEMENTS.LOCATIONS_MAX]: null,
    [ENTITLEMENTS.DISCOUNTS_ENABLED]: true,
    [ENTITLEMENTS.ACTIVE_DISCOUNTS_MAX]: null,
    [ENTITLEMENTS.COUPONS_ENABLED]: true,
    [ENTITLEMENTS.ADVANCED_INVENTORY_ENABLED]: true,
    [ENTITLEMENTS.ADVANCED_ANALYTICS_ENABLED]: true,
    [ENTITLEMENTS.PROMOTIONS_ENABLED]: true,
    [ENTITLEMENTS.ACTIVE_PROMOTIONS_MAX]: null,
    [ENTITLEMENTS.MONTHLY_PROMOTION_SPEND_MAX]: null,
    [ENTITLEMENTS.PRIORITY_SUPPORT_ENABLED]: true,
    [ENTITLEMENTS.MULTIPLE_LOCATIONS_ENABLED]: true,
    [ENTITLEMENTS.CUSTOM_PROFILE_ENABLED]: true,
    [ENTITLEMENTS.CUSTOMER_INSIGHTS_ENABLED]: true,
    [ENTITLEMENTS.SCHEDULED_DISCOUNTS_ENABLED]: true
  })
});

const DEFAULT_LEGACY_ENTITLEMENTS = Object.freeze({ advancedAnalytics: false, promotions: false, numberOfLocations: 1, staffLimit: 2, productLimit: 25, prioritySupport: false });

function entitlementType(key) { return key.endsWith('.max') ? ENTITLEMENT_TYPES.INTEGER_LIMIT : ENTITLEMENT_TYPES.BOOLEAN; }

function normalizeEntitlements(entitlements = {}) {
  return Object.fromEntries(Object.entries(entitlements).map(([key, value]) => [key, { type: entitlementType(key), value, unlimited: entitlementType(key) === ENTITLEMENT_TYPES.INTEGER_LIMIT && value === null }]));
}

function legacyEntitlementsFromMap(entitlements = {}) {
  return {
    ...DEFAULT_LEGACY_ENTITLEMENTS,
    advancedAnalytics: Boolean(entitlements[ENTITLEMENTS.ADVANCED_ANALYTICS_ENABLED]),
    promotions: Boolean(entitlements[ENTITLEMENTS.PROMOTIONS_ENABLED]),
    numberOfLocations: entitlements[ENTITLEMENTS.LOCATIONS_MAX] === null ? null : (entitlements[ENTITLEMENTS.LOCATIONS_MAX] ?? DEFAULT_LEGACY_ENTITLEMENTS.numberOfLocations),
    staffLimit: entitlements[ENTITLEMENTS.STAFF_MAX] === null ? null : (entitlements[ENTITLEMENTS.STAFF_MAX] ?? DEFAULT_LEGACY_ENTITLEMENTS.staffLimit),
    productLimit: entitlements[ENTITLEMENTS.PRODUCTS_MAX] === null ? null : (entitlements[ENTITLEMENTS.PRODUCTS_MAX] ?? DEFAULT_LEGACY_ENTITLEMENTS.productLimit),
    prioritySupport: Boolean(entitlements[ENTITLEMENTS.PRIORITY_SUPPORT_ENABLED])
  };
}

module.exports = { ENTITLEMENT_TYPES, ENTITLEMENTS, INITIAL_PLAN_ENTITLEMENTS, DEFAULT_LEGACY_ENTITLEMENTS, entitlementType, normalizeEntitlements, legacyEntitlementsFromMap };
