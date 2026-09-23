const { Business } = require('../businesses/business.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const productService = require('../products/product.service');
const serviceService = require('../services/service.service');
const contentPostService = require('../content-posts/content-post.service');
const promotionSelectionService = require('../advertising/promotion-selection.service');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function publicLocationBusinessIds({ city, latitude, longitude, radiusKm }) {
  if (!city && (latitude === undefined || longitude === undefined)) return null;
  const filter = { active: true, publiclyVisible: true };
  if (city) filter['address.city'] = new RegExp(escapeRegExp(city), 'i');
  if (latitude !== undefined && longitude !== undefined) {
    filter.location = { $near: { $geometry: { type: 'Point', coordinates: [longitude, latitude] }, $maxDistance: radiusKm * 1_000 } };
  }
  return BusinessLocation.find(filter).distinct('businessId');
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

async function discover(query) {
  const businessIds = await publicLocationBusinessIds(query);
  const productResult = ['businesses', 'services', 'posts'].includes(query.type)
    ? { products: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await productService.listPublicProducts({ search: query.q, categoryId: query.categoryId, businessIds, page: query.page, limit: query.limit, sort: query.sort });
  const businessResult = ['products', 'services', 'posts'].includes(query.type)
    ? { businesses: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await listPublicBusinesses({ search: query.q, categoryId: query.categoryId, businessIds, page: query.page, limit: query.limit });
  const serviceResult = ['products', 'businesses', 'posts'].includes(query.type)
    ? { services: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await serviceService.listPublicServices({ q: query.q, categoryId: query.categoryId, businessIds, page: query.page, limit: query.limit, sort: query.sort });
  const postResult = ['products', 'services', 'businesses'].includes(query.type)
    ? { posts: [], total: 0, page: query.page, limit: query.limit, pages: 0 }
    : await contentPostService.listDiscoverPosts(query, businessIds);

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

module.exports = { discover, listPublicBusinesses, publicLocationBusinessIds, escapeRegExp };
