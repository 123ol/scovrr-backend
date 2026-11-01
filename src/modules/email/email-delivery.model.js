const mongoose = require('mongoose');

const EMAIL_DELIVERY_STATUSES = Object.freeze([
  'queued', 'sending', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'dead'
]);

const emailDeliverySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  toEmail: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  toName: { type: String, trim: true, maxlength: 160, default: '' },
  templateKey: { type: String, required: true, trim: true, maxlength: 100 },
  category: { type: String, required: true, trim: true, maxlength: 50, index: true },
  subject: { type: String, required: true, trim: true, maxlength: 180 },
  status: { type: String, enum: EMAIL_DELIVERY_STATUSES, default: 'queued', index: true },
  providerMessageId: { type: String, trim: true, maxlength: 240, default: null, index: true },
  idempotencyKey: { type: String, required: true, trim: true, maxlength: 240, unique: true },
  encryptedPayload: {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true }
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  attempts: { type: Number, min: 0, default: 0 },
  lastError: { type: String, trim: true, maxlength: 1_000, default: null },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  sentAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  lastWebhookAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

emailDeliverySchema.index({ status: 1, nextAttemptAt: 1, createdAt: -1 });
emailDeliverySchema.index({ userId: 1, createdAt: -1 });

emailDeliverySchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    userId: this.userId?.toString() || null,
    toEmail: this.toEmail.replace(/^(.{2}).*(@.*)$/, '$1•••$2'),
    toName: this.toName,
    templateKey: this.templateKey,
    category: this.category,
    subject: this.subject,
    status: this.status,
    providerMessageId: this.providerMessageId,
    idempotencyKey: this.idempotencyKey,
    attempts: this.attempts,
    lastError: this.lastError,
    nextAttemptAt: this.nextAttemptAt,
    sentAt: this.sentAt,
    deliveredAt: this.deliveredAt,
    lastWebhookAt: this.lastWebhookAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const EmailDelivery = mongoose.model('EmailDelivery', emailDeliverySchema);

module.exports = { EmailDelivery, EMAIL_DELIVERY_STATUSES };
