const discoveryService = require('../discovery/discovery.service');
const { Favorite } = require('../favorites/favorite.model');
const { RecentlyViewed } = require('../discovery/recently-viewed.model');
const { Order } = require('../orders/order.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const mongoose = require('mongoose');
const { assignRankingVariant, rankWithVariant } = require('./ranking-experiment');

async function getHomeRecommendations(query) {
  const result = await discoveryService.discover({ ...query, type: 'all', page: 1, limit: query.limit || 12, sort: 'newest' });
  return {
    strategy: 'location_freshness_v1',
    sections: [
      { key: 'new_near_you', title: 'New near you', products: result.products, services: [], businesses: [] },
      { key: 'book_your_next_look', title: 'Book your next look', products: [], services: result.services, businesses: [] },
      { key: 'popular_businesses', title: 'Businesses to explore', products: [], services: [], businesses: result.businesses }
    ],
    meta: result.meta
  };
}

function safeCard(item) {
  const business = item.businessId?._id ? { id: item.businessId._id.toString(), name: item.businessId.name, slug: item.businessId.slug } : null;
  return { ...item.toCardJSON(), business };
}

function asKeySet(values = []) {
  return new Set(values.filter(Boolean).map((value) => value.toString()));
}

function scoreRecommendation(item, profile = {}) {
  const businessId = item.businessId?._id || item.businessId;
  const categoryId = item.categoryId?._id || item.categoryId;
  const businessMatch = profile.businessIds?.has(businessId?.toString()) ? 8 : 0;
  const categoryMatch = profile.categoryIds?.has(categoryId?.toString()) ? 5 : 0;
  const tagMatches = (item.tags || []).filter((tag) => profile.tags?.has(String(tag).toLowerCase())).length;
  const ratingSignal = Math.min(3, Math.max(0, Number(item.ratingAverage || 0) / 2));
  const publishedAt = item.publishedAt || item.createdAt;
  const ageDays = publishedAt ? Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 86_400_000) : 365;
  const freshnessSignal = Math.max(0, 2 - (ageDays / 30));
  return businessMatch + categoryMatch + (tagMatches * 2) + ratingSignal + freshnessSignal;
}

function rankRecommendations(items, profile, limit) {
  return items.map((item, index) => ({ item, score: scoreRecommendation(item, profile), index }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

async function getPersonalizedRecommendations(query, viewerId) {
  if (!viewerId) return getHomeRecommendations(query);
  const experiment = assignRankingVariant({ subjectId: viewerId });
  const [favorites, views, orders] = await Promise.all([
    Favorite.find({ userId: viewerId, targetType: { $in: ['product', 'service'] } }).sort({ createdAt: -1 }).limit(50).lean(),
    RecentlyViewed.find({ userId: viewerId }).sort({ viewedAt: -1 }).limit(50).lean(),
    Order.find({ customerId: viewerId, paymentStatus: { $in: ['successful', 'partially_refunded'] }, status: { $nin: ['cancelled', 'refunded'] } }).sort({ createdAt: -1 }).limit(20).select('items').lean()
  ]);
  const productIds = [...new Set([
    ...favorites.filter((item) => item.targetType === 'product').map((item) => item.targetId.toString()),
    ...views.filter((item) => item.targetType === 'product').map((item) => item.targetId.toString()),
    ...orders.flatMap((order) => order.items || []).map((item) => item.productId?.toString()).filter(Boolean)
  ])].slice(0, 50);
  const serviceIds = [...new Set([
    ...favorites.filter((item) => item.targetType === 'service').map((item) => item.targetId.toString()),
    ...views.filter((item) => item.targetType === 'service').map((item) => item.targetId.toString())
  ])].slice(0, 50);
  const [seedProducts, seedServices] = await Promise.all([
    productIds.length ? Product.find({ _id: { $in: productIds } }).select('categoryId businessId tags').lean() : [],
    serviceIds.length ? Service.find({ _id: { $in: serviceIds } }).select('categoryId businessId').lean() : []
  ]);
  const categoryIds = [...new Set([...seedProducts, ...seedServices].map((item) => item.categoryId?.toString()).filter(Boolean))];
  const businessIds = [...new Set([...seedProducts, ...seedServices].map((item) => item.businessId?.toString()).filter(Boolean))];
  const tags = [...new Set(seedProducts.flatMap((item) => item.tags || []))].slice(0, 20);
  const productSignals = [];
  if (categoryIds.length) productSignals.push({ categoryId: { $in: categoryIds } });
  if (businessIds.length) productSignals.push({ businessId: { $in: businessIds } });
  if (tags.length) productSignals.push({ tags: { $in: tags } });
  const serviceSignals = [];
  if (categoryIds.length) serviceSignals.push({ categoryId: { $in: categoryIds } });
  if (businessIds.length) serviceSignals.push({ businessId: { $in: businessIds } });
  const candidateLimit = Math.min(48, Math.max(query.limit || 12, (query.limit || 12) * 4));
  const [productCandidates, serviceCandidates] = await Promise.all([
    Product.find({ status: 'active', moderationStatus: 'approved', ...(productSignals.length ? { $or: productSignals } : {}) }).sort({ publishedAt: -1, createdAt: -1 }).limit(candidateLimit).populate('businessId', 'name slug status moderationStatus'),
    Service.find({ status: 'active', moderationStatus: 'approved', ...(serviceSignals.length ? { $or: serviceSignals } : {}) }).sort({ publishedAt: -1, createdAt: -1 }).limit(candidateLimit).populate('businessId', 'name slug status moderationStatus')
  ]);
  const profile = { categoryIds: asKeySet(categoryIds), businessIds: asKeySet(businessIds), tags: asKeySet(tags.map((tag) => tag.toLowerCase())) };
  const eligibleProducts = productCandidates.filter((item) => item.businessId?.status === 'active' && item.businessId?.moderationStatus === 'approved');
  const eligibleServices = serviceCandidates.filter((item) => item.businessId?.status === 'active' && item.businessId?.moderationStatus === 'approved');
  const products = rankWithVariant(eligibleProducts, profile, query.limit || 12, experiment, rankRecommendations);
  const services = rankWithVariant(eligibleServices, profile, query.limit || 12, experiment, rankRecommendations);
  return {
    strategy: 'behavioral_signals_v1',
    sections: [
      { key: 'recommended_products', title: 'Picked for you', products: products.filter((item) => item.businessId?.status === 'active' && item.businessId?.moderationStatus === 'approved').map(safeCard), services: [], businesses: [] },
      { key: 'recommended_services', title: 'Services you may like', products: [], services: services.filter((item) => item.businessId?.status === 'active' && item.businessId?.moderationStatus === 'approved').map(safeCard), businesses: [] }
    ],
    signals: { viewed: views.length, favorites: favorites.length, purchasedProducts: productIds.length },
    meta: { limit: query.limit || 12, personalized: true, experiment }
  };
}

async function frequentlyBoughtTogether(productId, limit = 6) {
  if (!mongoose.isValidObjectId(productId)) return [];
  const targetId = new mongoose.Types.ObjectId(productId);
  const rows = await Order.aggregate([
    { $match: { 'items.productId': targetId, paymentStatus: { $in: ['successful', 'partially_refunded'] }, status: { $nin: ['cancelled', 'refunded'] } } },
    { $unwind: '$items' },
    { $match: { 'items.productId': { $ne: targetId } } },
    { $group: { _id: '$items.productId', orderCount: { $sum: 1 }, quantity: { $sum: '$items.quantity' } } },
    { $sort: { orderCount: -1, quantity: -1 } },
    { $limit: Math.min(12, Math.max(1, limit)) }
  ]);
  if (!rows.length) return [];
  const products = await Product.find({ _id: { $in: rows.map((row) => row._id) }, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  const byId = new Map(products.filter((item) => item.businessId?.status === 'active' && item.businessId?.moderationStatus === 'approved').map((item) => [item._id.toString(), item]));
  return rows.map((row) => { const product = byId.get(row._id.toString()); return product ? { ...safeCard(product), purchaseSignals: { orderCount: row.orderCount, quantity: row.quantity } } : null; }).filter(Boolean);
}

module.exports = { getHomeRecommendations, getPersonalizedRecommendations, frequentlyBoughtTogether, scoreRecommendation, rankRecommendations };
