const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1_000, default: '' },
  media: { type: [{ url: { type: String, required: true, maxlength: 2_000 }, provider: String, publicId: String, alt: String, order: { type: Number, default: 0 } }], required: true, validate: [(values) => values.length > 0, 'A portfolio item needs media'] },
  tags: { type: [String], default: [] },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true, versionKey: false });

portfolioSchema.index({ businessId: 1, status: 1, sortOrder: 1 });

portfolioSchema.methods.toJSONSafe = function toJSONSafe() {
  return { id: this._id.toString(), businessId: this.businessId.toString(), serviceId: this.serviceId?.toString() || null, title: this.title, description: this.description, media: this.media, tags: this.tags, status: this.status, sortOrder: this.sortOrder, createdAt: this.createdAt };
};

const PortfolioItem = mongoose.model('PortfolioItem', portfolioSchema);

module.exports = { PortfolioItem };
