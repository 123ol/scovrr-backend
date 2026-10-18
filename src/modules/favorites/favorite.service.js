const { AppError } = require('../../common/errors/AppError');
const { Favorite } = require('./favorite.model');
const { FavoriteCollection } = require('./favorite-collection.model');
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

const MAX_ACTIVE_COLLECTIONS = 50;

function normalizeCollectionName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function collectionNameKey(name) {
  return normalizeCollectionName(name).toLocaleLowerCase();
}

async function createCollection(userId, input) {
  const name = normalizeCollectionName(input.name);
  const count = await FavoriteCollection.countDocuments({ userId, status: 'active' });
  if (count >= MAX_ACTIVE_COLLECTIONS) throw new AppError(409, 'FAVORITE_COLLECTION_LIMIT', 'You can create up to 50 saved collections');
  try {
    return await FavoriteCollection.create({ userId, name, normalizedName: collectionNameKey(name) });
  } catch (error) {
    if (error?.code === 11000) throw new AppError(409, 'FAVORITE_COLLECTION_EXISTS', 'A saved collection with this name already exists');
    throw error;
  }
}

async function listCollections(userId) {
  const [collections, counts] = await Promise.all([
    FavoriteCollection.find({ userId, status: 'active' }).sort({ updatedAt: -1, createdAt: -1 }).limit(MAX_ACTIVE_COLLECTIONS),
    Favorite.aggregate([{ $match: { userId, collectionId: { $ne: null } } }, { $group: { _id: '$collectionId', count: { $sum: 1 } } }])
  ]);
  const countById = new Map(counts.map((item) => [item._id.toString(), item.count]));
  return collections.map((collection) => ({ ...collection.toSafeJSON(), itemCount: countById.get(collection._id.toString()) || 0 }));
}

async function updateCollection(userId, collectionId, input) {
  const collection = await FavoriteCollection.findOne({ _id: collectionId, userId, status: 'active' });
  if (!collection) throw new AppError(404, 'FAVORITE_COLLECTION_NOT_FOUND', 'Saved collection not found');
  if (input.name !== undefined) {
    const name = normalizeCollectionName(input.name);
    collection.name = name;
    collection.normalizedName = collectionNameKey(name);
  }
  if (input.status !== undefined) collection.status = input.status;
  try {
    await collection.save();
  } catch (error) {
    if (error?.code === 11000) throw new AppError(409, 'FAVORITE_COLLECTION_EXISTS', 'A saved collection with this name already exists');
    throw error;
  }
  return collection;
}

async function assignFavoriteToCollection(userId, targetType, targetId, collectionId) {
  const favorite = await Favorite.findOne({ userId, targetType, targetId });
  if (!favorite) throw new AppError(404, 'FAVORITE_NOT_FOUND', 'Save the item before assigning it to a collection');
  if (collectionId) {
    const collection = await FavoriteCollection.findOne({ _id: collectionId, userId, status: 'active' });
    if (!collection) throw new AppError(404, 'FAVORITE_COLLECTION_NOT_FOUND', 'Saved collection not found');
  }
  favorite.collectionId = collectionId || null;
  await favorite.save();
  return { id: favorite._id.toString(), targetType: favorite.targetType, targetId: favorite.targetId.toString(), collectionId: favorite.collectionId?.toString() || null };
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
    return { id: favorite._id.toString(), targetType: favorite.targetType, target: target ? (favorite.targetType === 'product' || favorite.targetType === 'service' ? target.toCardJSON() : target.toPublicJSON()) : null, collectionId: favorite.collectionId?.toString() || null, createdAt: favorite.createdAt };
  })).then((items) => items.filter((item) => item.target));
}

module.exports = { addFavorite, removeFavorite, listFavorites, ensureTarget, createCollection, listCollections, updateCollection, assignFavoriteToCollection, normalizeCollectionName, collectionNameKey, MAX_ACTIVE_COLLECTIONS };
