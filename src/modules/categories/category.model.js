const mongoose = require('mongoose');

const CATEGORY_TYPES = ['product', 'service', 'both'];

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 500 },
  icon: { type: String, trim: true, maxlength: 120 },
  image: { type: String, trim: true, maxlength: 2_000 },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
  type: { type: String, enum: CATEGORY_TYPES, required: true, default: 'both', index: true },
  sortOrder: { type: Number, default: 0, min: 0 },
  enabled: { type: Boolean, default: true, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: undefined }
}, { timestamps: true, versionKey: false });

categorySchema.index({ parent: 1, enabled: 1, sortOrder: 1 });

categorySchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    slug: this.slug,
    description: this.description || null,
    icon: this.icon || null,
    image: this.image || null,
    parentId: this.parent ? this.parent.toString() : null,
    type: this.type,
    sortOrder: this.sortOrder,
    enabled: this.enabled
  };
};

const Category = mongoose.model('Category', categorySchema);

module.exports = { Category, CATEGORY_TYPES };
