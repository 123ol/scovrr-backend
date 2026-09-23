const mongoose = require('mongoose');

const paymentEventSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  eventType: { type: String, required: true },
  reference: { type: String, default: null },
  payloadHash: { type: String, required: true },
  signatureVerified: { type: Boolean, default: false },
  receivedAt: { type: Date, default: Date.now, index: true },
  status: { type: String, enum: ['received', 'processed', 'failed'], default: 'received' },
  failureReason: { type: String, default: null },
  processedAt: { type: Date, default: null },
  retryCount: { type: Number, min: 0, default: 0 },
  nextRetryAt: { type: Date, default: null },
  lastAttemptAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

const PaymentEvent = mongoose.model('PaymentEvent', paymentEventSchema);

module.exports = { PaymentEvent };
