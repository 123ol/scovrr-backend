const mongoose = require('mongoose');

const followSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true }
}, { timestamps: true, versionKey: false });

followSchema.index({ userId: 1, businessId: 1 }, { unique: true });

const Follow = mongoose.model('Follow', followSchema);

module.exports = { Follow };
