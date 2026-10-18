const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['product', 'service', 'business'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FavoriteCollection', default: null, index: true }
}, { timestamps: true, versionKey: false });

favoriteSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });

const Favorite = mongoose.model('Favorite', favoriteSchema);

module.exports = { Favorite };
