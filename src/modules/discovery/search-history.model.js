const mongoose = require('mongoose');

const searchHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  query: { type: String, required: true, trim: true, maxlength: 120 },
  normalized: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
  count: { type: Number, min: 1, default: 1 },
  lastSearchedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true, versionKey: false });

searchHistorySchema.index({ userId: 1, normalized: 1 }, { unique: true });
searchHistorySchema.index({ normalized: 1, lastSearchedAt: -1 });

searchHistorySchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), query: this.query, count: this.count, lastSearchedAt: this.lastSearchedAt, createdAt: this.createdAt };
};

const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);

module.exports = { SearchHistory };
