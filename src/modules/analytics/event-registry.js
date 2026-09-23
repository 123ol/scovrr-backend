const EVENT_AUTHORITIES = Object.freeze({ CLIENT: 'client', SERVER: 'server', SYSTEM: 'system' });
const EVENT_ACTORS = Object.freeze(['user', 'anonymous', 'business', 'system']);
const EVENT_SOURCES = Object.freeze(['APP', 'WEB', 'ADMIN', 'API', 'SYSTEM', 'HOME', 'NEAR_YOU', 'CATEGORY', 'SEARCH', 'BUSINESS_PROFILE', 'FOLLOWING', 'SPONSORED']);
const EVENT_PLATFORMS = Object.freeze(['ios', 'android', 'web', 'admin', 'server']);
const COMMON_METADATA_KEYS = Object.freeze([
  'query', 'queryLength', 'resultCount', 'filterCount', 'sort', 'tab', 'categoryId', 'categoryIds', 'position', 'listId',
  'placement', 'source', 'currency', 'amountMinor', 'quantity', 'variantId', 'orderId', 'bookingId', 'paymentId',
  'businessId', 'locationId', 'serviceId', 'productId', 'promotionId', 'campaignId', 'subscriptionId', 'planKey',
  'discountMinor', 'reason', 'status', 'requestType', 'locationType', 'hasAvailability', 'isSponsored', 'attributionWindowDays'
]);

const definitions = {};
function define(name, authority, options = {}) {
  definitions[name] = Object.freeze({
    name, version: options.version || 1, authority, category: options.category || 'behavioral',
    privacyClass: options.privacyClass || 'analytics', retentionClass: options.retentionClass || (authority === EVENT_AUTHORITIES.CLIENT ? 'behavioral' : 'domain'),
    allowedMetadataKeys: Object.freeze(options.allowedMetadataKeys || COMMON_METADATA_KEYS), clientAllowed: options.clientAllowed === true,
    description: options.description || ''
  });
}

define('USER_REGISTERED', EVENT_AUTHORITIES.SERVER, { category: 'identity' });
define('USER_LOGIN_SUCCEEDED', EVENT_AUTHORITIES.SERVER, { category: 'identity' });
define('BUSINESS_CREATED', EVENT_AUTHORITIES.SERVER, { category: 'business' });
define('SESSION_STARTED', EVENT_AUTHORITIES.CLIENT, { clientAllowed: true, category: 'identity', retentionClass: 'short_behavioral' });
[
  ['BUSINESS_VIEWED', 'business'], ['BUSINESS_FOLLOWED', 'business'], ['BUSINESS_UNFOLLOWED', 'business'], ['DISCOVER_VIEWED', 'discovery'],
  ['CATEGORY_VIEWED', 'discovery'], ['SEARCH_PERFORMED', 'discovery'], ['SEARCH_RESULT_CLICKED', 'discovery'], ['PRODUCT_VIEWED', 'product'],
  ['PRODUCT_SAVED', 'product'], ['PRODUCT_UNSAVED', 'product'], ['PRODUCT_ADDED_TO_CART', 'product'], ['PRODUCT_REMOVED_FROM_CART', 'product'],
  ['CHECKOUT_STARTED', 'commerce'], ['SERVICE_VIEWED', 'service'], ['SERVICE_SAVED', 'service'], ['SERVICE_UNSAVED', 'service'],
  ['BOOKING_STARTED', 'service'], ['REVIEW_CREATED', 'engagement'], ['CONVERSATION_STARTED', 'engagement']
].forEach(([name, category]) => define(name, EVENT_AUTHORITIES.CLIENT, { clientAllowed: true, category }));
[
  'ORDER_CREATED', 'ORDER_PAID', 'ORDER_CANCELLED', 'ORDER_DELIVERED', 'ORDER_COMPLETED', 'ORDER_REFUNDED',
  'BOOKING_CREATED', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_COMPLETED', 'BOOKING_REFUNDED',
  'DISCOUNT_APPLIED', 'COUPON_REDEEMED', 'SUBSCRIPTION_STARTED', 'SUBSCRIPTION_RENEWED', 'SUBSCRIPTION_CANCELLED',
  'SUBSCRIPTION_EXPIRED', 'PROMOTION_IMPRESSION', 'PROMOTION_CLICK', 'PROMOTION_CONVERSION'
].forEach((name) => define(name, EVENT_AUTHORITIES.SERVER, { category: name.startsWith('ORDER') || name.startsWith('BOOKING') ? 'commerce' : 'growth', privacyClass: name.includes('REFUND') ? 'financial' : 'analytics' }));

const LEGACY_EVENT_NAMES = Object.freeze({
  home_impression: 'DISCOVER_VIEWED', business_impression: 'BUSINESS_VIEWED', product_impression: 'PRODUCT_VIEWED', product_view: 'PRODUCT_VIEWED',
  service_view: 'SERVICE_VIEWED', search: 'SEARCH_PERFORMED', search_click: 'SEARCH_RESULT_CLICKED', favorite: 'PRODUCT_SAVED',
  add_to_cart: 'PRODUCT_ADDED_TO_CART', checkout_started: 'CHECKOUT_STARTED', purchase: 'ORDER_PAID', booking: 'BOOKING_CREATED',
  follow: 'BUSINESS_FOLLOWED', message_started: 'CONVERSATION_STARTED', review_created: 'REVIEW_CREATED'
});
function normalizeEventName(name) { const value = String(name || '').trim(); return LEGACY_EVENT_NAMES[value] || value.toUpperCase(); }
function getEventDefinition(name) { return definitions[normalizeEventName(name)] || null; }
const ANALYTICS_EVENT_NAMES = Object.freeze(Object.keys(definitions));
const CLIENT_EVENT_NAMES = Object.freeze(ANALYTICS_EVENT_NAMES.filter((name) => definitions[name].clientAllowed));
const SERVER_EVENT_NAMES = Object.freeze(ANALYTICS_EVENT_NAMES.filter((name) => !definitions[name].clientAllowed));

module.exports = { EVENT_AUTHORITIES, EVENT_ACTORS, EVENT_SOURCES, EVENT_PLATFORMS, COMMON_METADATA_KEYS, ANALYTICS_EVENT_NAMES, CLIENT_EVENT_NAMES, SERVER_EVENT_NAMES, LEGACY_EVENT_NAMES, normalizeEventName, getEventDefinition };
