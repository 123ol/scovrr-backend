const mongoose = require('mongoose');

const businessActivitySchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  action: { type: String, required: true, trim: true, maxlength: 100, index: true },
  targetType: { type: String, required: true, trim: true, maxlength: 80 },
  targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  reason: { type: String, trim: true, maxlength: 1_000 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

businessActivitySchema.index({ businessId: 1, createdAt: -1 });

const BusinessActivity = mongoose.model('BusinessActivity', businessActivitySchema);

module.exports = { BusinessActivity };
