const mongoose = require('mongoose');

const subscriptionEventSchema = new mongoose.Schema({
  subscriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessSubscription', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  type: { type: String, required: true, trim: true, maxlength: 100, index: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });
subscriptionEventSchema.index({ subscriptionId: 1, createdAt: -1 });
const SubscriptionEvent = mongoose.models.SubscriptionEvent || mongoose.model('SubscriptionEvent', subscriptionEventSchema);
module.exports = { SubscriptionEvent };
