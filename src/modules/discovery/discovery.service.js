const { Business } = require('../businesses/business.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { Category } = require('../categories/category.model');
const { ensureDefaultCategories } = require('../categories/category.service');
const { AppError } = require('../../common/errors/AppError');
const productService = require('../products/product.service');
const serviceService = require('../services/service.service');
const contentPostService = require('../content-posts/content-post.service');
const promotionSelectionService = require('../advertising/promotion-selection.service');

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
    queries.push(BusinessLocation.find({ ...baseFilter, 'address.city': new RegExp(escapeRegExp(city), 'i') }).select('_id businessId').lean());
  }

  const locations = (await Promise.all(queries)).flat();
  const locationIds = [...new Set(locations.map((location) => location._id.toString()))];
  const businessIds = [...new Set(locations.map((location) => location.businessId.toString()))];
  return { locationIds, businessIds };
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

async function listPublicBusinesses({ search, categoryId, businessIds, page, limit }) {
  const filter = { status: 'active', moderationStatus: 'approved' };
  if (categoryId) filter.categories = categoryId;
  if (businessIds) filter._id = { $in: businessIds };
  if (search) {
    const expression = new RegExp(escapeRegExp(search.trim()), 'i');
    filter.$or = [{ name: expression }, { description: expression }];
  }
  const skip = (page - 1) * limit;
  const [businesses, total] = await Promise.all([
    Business.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Business.countDocuments(filter)
  ]);
  return { businesses: businesses.map((business) => business.toPublicJSON()), total, page, limit, pages: Math.ceil(total / limit) };
}

async function discover(query, viewerId) {
  const locationContext = await publicLocationContext(query);
  const businessIds = locationContext?.businessIds || null;
  const categoryId = await resolveCategoryId(query);
  const productResult = ['businesses', 'services', 'posts'].includes(query.type)
    ? { products: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await productService.listPublicProducts({ search: query.q, categoryId, businessIds, page: query.page, limit: query.limit, sort: query.sort });
  const businessResult = ['products', 'services', 'posts'].includes(query.type)
    ? { businesses: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await listPublicBusinesses({ search: query.q, categoryId, businessIds, page: query.page, limit: query.limit });
  const serviceResult = ['products', 'businesses', 'posts'].includes(query.type)
    ? { services: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await serviceService.listPublicServices({ q: query.q, categoryId, businessIds, locationIds: locationContext?.locationIds || null, page: query.page, limit: query.limit, sort: query.sort });
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

module.exports = { discover, listPublicBusinesses, publicLocationBusinessIds, resolveCategoryId, escapeRegExp };
