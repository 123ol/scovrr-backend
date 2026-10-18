const mongoose = require('mongoose');

const favoriteCollectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  normalizedName: { type: String, required: true, maxlength: 80 },
  status: { type: String, enum: ['active', 'archived'], default: 'active', index: true }
}, { timestamps: true, versionKey: false });

favoriteCollectionSchema.index({ userId: 1, normalizedName: 1 }, { unique: true });
favoriteCollectionSchema.index({ userId: 1, status: 1, updatedAt: -1 });

favoriteCollectionSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), name: this.name, status: this.status, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const FavoriteCollection = mongoose.model('FavoriteCollection', favoriteCollectionSchema);

module.exports = { FavoriteCollection };
