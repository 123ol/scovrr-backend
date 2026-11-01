const mongoose = require('mongoose');

const emailWebhookEventSchema = new mongoose.Schema({
  providerEventId: { type: String, required: true, unique: true, trim: true, maxlength: 240 },
  type: { type: String, required: true, trim: true, maxlength: 120 },
  providerMessageId: { type: String, trim: true, maxlength: 240, default: null, index: true },
  receivedAt: { type: Date, default: Date.now },
  processedAt: { type: Date, default: null }
}, { versionKey: false });

const EmailWebhookEvent = mongoose.model('EmailWebhookEvent', emailWebhookEventSchema);

module.exports = { EmailWebhookEvent };
