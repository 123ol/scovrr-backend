const { Business } = require('../businesses/business.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Category } = require('../categories/category.model');
const { ensureDefaultCategories } = require('../categories/category.service');
const { AppError } = require('../../common/errors/AppError');
const productService = require('../products/product.service');
const serviceService = require('../services/service.service');
const contentPostService = require('../content-posts/content-post.service');
const promotionSelectionService = require('../advertising/promotion-selection.service');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { ContentPost } = require('../content-posts/content-post.model');
const { SearchHistory } = require('./search-history.model');
const { rankSearchResults, rankByBusinessOrder } = require('./search-ranking');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function publicLocationContext({ city, latitude, longitude, radiusKm = 25 } = {}) {
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  if (!city && !hasCoordinates) return null;

  const baseFilter = {
    active: true,
    publiclyVisible: true,
    'location.coordinates.0': { $exists: true },
    'location.coordinates.1': { $exists: true }
  };
  const queries = [];
  if (hasCoordinates) {
    queries.push(BusinessLocation.find({
      ...baseFilter,
      location: { $near: { $geometry: { type: 'Point', coordinates: [longitude, latitude] }, $maxDistance: radiusKm * 1_000 } }
    }).select('_id businessId').lean());
  } else if (city) {
    // City is a fallback for saved/manual locations without GPS. When GPS is
    // present, the radius is the authoritative nearby filter.
    queries.push(BusinessLocation.find({ active: true, publiclyVisible: true, 'address.city': new RegExp(escapeRegExp(city), 'i') }).select('_id businessId').lean());
  }

  const locations = (await Promise.all(queries)).flat();
  const locationIds = [...new Set(locations.map((location) => location._id.toString()))];
  const businessIds = [...new Set(locations.map((location) => location.businessId.toString()))];
  return { locationIds, businessIds, businessOrder: hasCoordinates ? businessIds : null };
}

async function publicLocationBusinessIds(query) {
  const context = await publicLocationContext(query);
  return context?.businessIds || null;
}

async function resolveCategoryId({ categoryId, categorySlug }) {
  if (categoryId) return categoryId;
  if (!categorySlug) return undefined;
  await ensureDefaultCategories();
  // Admin-created product-only and service-only categories are valid filters
  // too; the listing type determines which catalogue can match them.
  const category = await Category.findOne({ slug: categorySlug, enabled: true }).select('_id');
  if (!category) throw new AppError(400, 'CATEGORY_NOT_FOUND', 'The selected category is unavailable');
  return category._id;
}

async function listPublicBusinesses({ search, categoryId, businessIds, businessOrder, ratingMin, page, limit }) {
  const filter = { status: 'active', moderationStatus: 'approved' };
  if (categoryId) filter.categories = categoryId;
  if (businessIds) filter._id = { $in: businessIds };
  if (ratingMin !== undefined) filter.ratingAverage = { $gte: ratingMin };
  if (search) {
    const expression = new RegExp(escapeRegExp(search.trim()), 'i');
    filter.$or = [{ name: expression }, { description: expression }];
  }
  const skip = (page - 1) * limit;
  const locationAware = !search && Array.isArray(businessOrder) && businessOrder.length > 0;
  const candidateLimit = search || locationAware ? Math.min(500, Math.max(limit * 5, skip + limit)) : limit;
  const [businesses, total] = await Promise.all([
    Business.find(filter).sort({ createdAt: -1 }).skip(search || locationAware ? 0 : skip).limit(candidateLimit),
    Business.countDocuments(filter)
  ]);
  const ranked = search ? rankSearchResults(businesses, search, (business) => [
    { value: business.name, weight: 10 },
    { value: business.slug, weight: 8 },
    { value: business.description, weight: 3 }
  ], { businessOrder, getBusinessId: (business) => business._id }) : (locationAware ? rankByBusinessOrder(businesses, businessOrder, (business) => business._id) : businesses);
  return { businesses: ranked.slice(search || locationAware ? skip : 0, search || locationAware ? skip + limit : limit).map((business) => business.toPublicJSON()), total, page, limit, pages: Math.ceil(total / limit) };
}

function distanceKm(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const radians = (value) => value * Math.PI / 180;
  const a = Math.sin(radians(toLatitude - fromLatitude) / 2) ** 2 + Math.cos(radians(fromLatitude)) * Math.cos(radians(toLatitude)) * Math.sin(radians(toLongitude - fromLongitude) / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearbyLocationQuery({ latitude, longitude, radiusKm = 25 }) {
  return {
    active: true,
    publiclyVisible: true,
    location: { $near: { $geometry: { type: 'Point', coordinates: [longitude, latitude] }, $maxDistance: radiusKm * 1_000 } }
  };
}

function compareNearbyLocations(left, right) {
  const distanceDifference = (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY);
  if (distanceDifference) return distanceDifference;
  return Number(Boolean(right.primary)) - Number(Boolean(left.primary));
}

async function listNearbyBusinesses({ latitude, longitude, radiusKm = 25, page = 1, limit = 20 }) {
  // `$near` already orders by distance. Do not apply a competing database sort
  // before pagination; primary locations are only a deterministic tie-breaker.
  const locations = await BusinessLocation.find(nearbyLocationQuery({ latitude, longitude, radiusKm })).skip((page - 1) * limit).limit(limit).populate({ path: 'businessId', match: { status: 'active', moderationStatus: 'approved' }, select: 'name slug description ratingAverage ratingCount storefront verification' }).lean();
  const businesses = locations.filter((location) => location.businessId).map((location) => {
    const business = new Business(location.businessId);
    const coordinates = location.location?.coordinates || [];
    return {
      primary: location.primary,
      location: { id: location._id.toString(), name: location.name, city: location.address?.city || null, state: location.address?.state || null, area: location.address?.area || null, coordinates: location.publicExactAddress ? coordinates : null },
      business: business.toPublicJSON(),
      distanceKm: coordinates.length === 2 ? Number(distanceKm(latitude, longitude, coordinates[1], coordinates[0]).toFixed(2)) : null
    };
  }).sort(compareNearbyLocations).map(({ primary: _primary, ...result }) => result);
  return { businesses, latitude, longitude, radiusKm, page, limit };
}

async function discover(query, viewerId) {
  const locationContext = await publicLocationContext(query);
  const businessIds = locationContext?.businessIds || null;
  const categoryId = await resolveCategoryId(query);
  const businessOrder = locationContext?.businessOrder || null;
  const productResult = ['businesses', 'services', 'posts'].includes(query.type)
    ? { products: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await productService.listPublicProducts({ search: query.q, categoryId, businessIds, businessOrder, page: query.page, limit: query.limit, sort: query.sort, minPriceMinor: query.minPriceMinor, maxPriceMinor: query.maxPriceMinor, condition: query.condition });
  const businessResult = ['products', 'services', 'posts'].includes(query.type)
    ? { businesses: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await listPublicBusinesses({ search: query.q, categoryId, businessIds, businessOrder, ratingMin: query.ratingMin, page: query.page, limit: query.limit });
  const serviceResult = ['products', 'businesses', 'posts'].includes(query.type)
    ? { services: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await serviceService.listPublicServices({ q: query.q, categoryId, businessIds, businessOrder, locationIds: locationContext?.locationIds || null, locationType: query.locationType, page: query.page, limit: query.limit, sort: query.sort, minPriceMinor: query.minPriceMinor, maxPriceMinor: query.maxPriceMinor });
  const postResult = ['products', 'services', 'businesses'].includes(query.type)
    ? { posts: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await contentPostService.listDiscoverPosts(query, businessIds, viewerId);

  const result = {
    products: productResult.products,
    businesses: businessResult.businesses,
    services: serviceResult.services,
    posts: postResult.posts,
    meta: {
      query: query.q || '',
      type: query.type,
      city: query.city || null,
      radiusKm: query.radiusKm,
      page: query.page,
      limit: query.limit,
      products: { total: productResult.total, pages: productResult.pages },
      businesses: { total: businessResult.total, pages: businessResult.pages },
      services: { total: serviceResult.total, pages: serviceResult.pages }
      ,posts: { total: postResult.total, pages: postResult.pages }
    }
  };
  return promotionSelectionService.mixDiscovery(result, query);
}

async function searchSuggestions(query = '', viewerId = null) {
  const term = String(query || '').trim();
  const trendingPromise = SearchHistory.aggregate([
    { $match: { lastSearchedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000) } } },
    { $group: { _id: '$normalized', count: { $sum: '$count' }, lastSearchedAt: { $max: '$lastSearchedAt' } } },
    { $sort: { count: -1, lastSearchedAt: -1 } },
    { $limit: 8 }
  ]);
  if (term.length < 2) return { suggestions: [], trending: (await trendingPromise).map((item) => item._id) };
  const expression = new RegExp(escapeRegExp(term), 'i');
  const [products, services, businesses, posts, trending] = await Promise.all([
    Product.find({ status: 'active', moderationStatus: 'approved', name: expression }).select('name slug').limit(5).lean(),
    Service.find({ status: 'active', moderationStatus: 'approved', name: expression }).select('name slug').limit(5).lean(),
    Business.find({ status: 'active', moderationStatus: 'approved', $or: [{ name: expression }, { description: expression }] }).select('name slug').limit(5).lean(),
    ContentPost.find({ status: 'active', moderationStatus: 'approved', $or: [{ title: expression }, { body: expression }, { hashtags: expression }] }).select('title body hashtags').limit(5).lean(),
    trendingPromise
  ]);
  const postSuggestions = buildPostSuggestions(posts, expression);
  const suggestions = [
    ...products.map((item) => ({ type: 'product', id: item._id.toString(), label: item.name, slug: item.slug })),
    ...services.map((item) => ({ type: 'service', id: item._id.toString(), label: item.name, slug: item.slug })),
    ...businesses.map((item) => ({ type: 'business', id: item._id.toString(), label: item.name, slug: item.slug })),
    ...postSuggestions
  ].slice(0, 12);
  const history = viewerId ? await SearchHistory.find({ userId: viewerId, normalized: new RegExp(`^${escapeRegExp(term)}`, 'i') }).sort({ lastSearchedAt: -1 }).limit(5) : [];
  return { suggestions, recent: history.map((item) => item.toSafeJSON()), trending: trending.map((item) => item._id) };
}

function buildPostSuggestions(posts, expression) {
  return posts.flatMap((item) => {
    const matchingHashtags = (item.hashtags || []).filter((hashtag) => expression.test(hashtag));
    if (matchingHashtags.length > 0) return matchingHashtags.map((hashtag) => ({ type: 'hashtag', id: `${item._id.toString()}-${hashtag}`, label: hashtag }));
    return [{ type: 'post', id: item._id.toString(), label: item.title || (item.body || '').slice(0, 80) }];
  });
}

async function recordSearch(userId, query) {
  const value = String(query || '').trim();
  if (!value) return null;
  return SearchHistory.findOneAndUpdate({ userId, normalized: value.toLowerCase() }, { $set: { query: value, lastSearchedAt: new Date() }, $inc: { count: 1 }, $setOnInsert: { userId, normalized: value.toLowerCase() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

async function listSearchHistory(userId, limit = 20) {
  const items = await SearchHistory.find({ userId }).sort({ lastSearchedAt: -1 }).limit(limit);
  return items.map((item) => item.toSafeJSON());
}

async function removeSearchHistory(userId, historyId) {
  await SearchHistory.deleteOne({ _id: historyId, userId });
}

module.exports = { discover, listPublicBusinesses, listNearbyBusinesses, publicLocationContext, publicLocationBusinessIds, resolveCategoryId, escapeRegExp, searchSuggestions, buildPostSuggestions, recordSearch, listSearchHistory, removeSearchHistory, nearbyLocationQuery, compareNearbyLocations };
