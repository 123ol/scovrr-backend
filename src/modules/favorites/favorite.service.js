const { AppError } = require('../../common/errors/AppError');
const { Favorite } = require('./favorite.model');
const { Product } = require('../products/product.model');
const { Business } = require('../businesses/business.model');
const { Service } = require('../services/service.model');

async function ensureTarget(targetType, targetId) {
  const target = targetType === 'product'
    ? await Product.findOne({ _id: targetId, status: 'active', moderationStatus: 'approved' })
    : targetType === 'service'
      ? await Service.findOne({ _id: targetId, status: 'active', moderationStatus: 'approved' })
      : await Business.findOne({ _id: targetId, status: 'active', moderationStatus: 'approved' });
  if (!target) throw new AppError(404, 'FAVORITE_TARGET_NOT_FOUND', 'The item you tried to save is unavailable');
}

async function addFavorite(userId, input) {
  await ensureTarget(input.targetType, input.targetId);
  return Favorite.findOneAndUpdate({ userId, targetType: input.targetType, targetId: input.targetId }, { $setOnInsert: { userId, targetType: input.targetType, targetId: input.targetId } }, { upsert: true, new: true });
}

async function removeFavorite(userId, targetType, targetId) {
  await Favorite.deleteOne({ userId, targetType, targetId });
}

async function listFavorites(userId) {
  const favorites = await Favorite.find({ userId }).sort({ createdAt: -1 });
  return Promise.all(favorites.map(async (favorite) => {
    const target = favorite.targetType === 'product'
      ? await Product.findOne({ _id: favorite.targetId, status: 'active', moderationStatus: 'approved' })
      : favorite.targetType === 'service'
        ? await Service.findOne({ _id: favorite.targetId, status: 'active', moderationStatus: 'approved' })
        : await Business.findOne({ _id: favorite.targetId, status: 'active', moderationStatus: 'approved' });
    return { id: favorite._id.toString(), targetType: favorite.targetType, target: target ? (favorite.targetType === 'product' || favorite.targetType === 'service' ? target.toCardJSON() : target.toPublicJSON()) : null, createdAt: favorite.createdAt };
  })).then((items) => items.filter((item) => item.target));
}

module.exports = { addFavorite, removeFavorite, listFavorites, ensureTarget };
