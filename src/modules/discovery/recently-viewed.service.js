const { AppError } = require('../../common/errors/AppError');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { RecentlyViewed } = require('./recently-viewed.model');

function targetModel(targetType) {
  return targetType === 'product' ? Product : Service;
}

async function ensurePublicTarget(targetType, targetId) {
  const Model = targetModel(targetType);
  const target = await Model.findOne({ _id: targetId, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!target || !target.businessId || target.businessId.status !== 'active' || target.businessId.moderationStatus !== 'approved') {
    throw new AppError(404, 'RECENTLY_VIEWED_TARGET_NOT_FOUND', 'This item is no longer available');
  }
  return target;
}

async function recordView(userId, { targetType, targetId }) {
  await ensurePublicTarget(targetType, targetId);
  return RecentlyViewed.findOneAndUpdate(
    { userId, targetType, targetId },
    { $set: { viewedAt: new Date() }, $setOnInsert: { userId, targetType, targetId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function targetJSON(targetType, target, viewedAt) {
  const card = target.toCardJSON();
  return {
    id: target._id.toString(),
    targetType,
    viewedAt,
    target: {
      ...card,
      business: target.businessId?._id ? { id: target.businessId._id.toString(), name: target.businessId.name, slug: target.businessId.slug } : null
    }
  };
}

async function listViews(userId, limit = 20) {
  const views = await RecentlyViewed.find({ userId }).sort({ viewedAt: -1 }).limit(limit).lean();
  if (!views.length) return [];
  const productIds = views.filter((view) => view.targetType === 'product').map((view) => view.targetId);
  const serviceIds = views.filter((view) => view.targetType === 'service').map((view) => view.targetId);
  const [products, services] = await Promise.all([
    productIds.length ? Product.find({ _id: { $in: productIds }, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus') : [],
    serviceIds.length ? Service.find({ _id: { $in: serviceIds }, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus') : []
  ]);
  const targets = new Map([...products, ...services].filter((target) => target.businessId?.status === 'active' && target.businessId?.moderationStatus === 'approved').map((target) => [target._id.toString(), target]));
  return views.map((view) => {
    const target = targets.get(view.targetId.toString());
    return target ? targetJSON(view.targetType, target, view.viewedAt) : null;
  }).filter(Boolean);
}

module.exports = { recordView, listViews, ensurePublicTarget, targetJSON };
