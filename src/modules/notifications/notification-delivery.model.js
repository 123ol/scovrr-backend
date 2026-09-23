const mongoose = require('mongoose');

const DELIVERY_STATUSES = ['queued', 'sent', 'failed', 'dead'];

const deliverySchema = new mongoose.Schema({
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceTokenId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeviceToken', required: true, index: true },
  status: { type: String, enum: DELIVERY_STATUSES, default: 'queued', index: true },
  attempts: { type: Number, min: 0, default: 0 },
  expoTicketId: { type: String, trim: true, maxlength: 200, default: null },
  receiptStatus: { type: String, trim: true, maxlength: 80, default: null },
  receiptError: { type: String, trim: true, maxlength: 500, default: null },
  receiptCheckedAt: { type: Date, default: null },
  lastError: { type: String, trim: true, maxlength: 1_000, default: null },
  nextAttemptAt: { type: Date, default: null, index: true },
  sentAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

deliverySchema.index({ notificationId: 1, deviceTokenId: 1 }, { unique: true });
deliverySchema.index({ status: 1, receiptCheckedAt: 1, createdAt: 1 });

const NotificationDelivery = mongoose.model('NotificationDelivery', deliverySchema);

module.exports = { NotificationDelivery, DELIVERY_STATUSES };
