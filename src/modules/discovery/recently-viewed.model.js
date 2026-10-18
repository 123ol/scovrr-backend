const mongoose = require('mongoose');

const recentlyViewedSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['product', 'service'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
  viewedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true, versionKey: false });

recentlyViewedSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
recentlyViewedSchema.index({ userId: 1, viewedAt: -1 });

const RecentlyViewed = mongoose.model('RecentlyViewed', recentlyViewedSchema);

module.exports = { RecentlyViewed };
