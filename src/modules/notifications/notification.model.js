const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, trim: true, maxlength: 100 },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  body: { type: String, required: true, trim: true, maxlength: 500 },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  deduplicationKey: { type: String, unique: true, sparse: true, index: true },
  readAt: { type: Date, default: null, index: true }
}, { timestamps: true, versionKey: false });

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

notificationSchema.methods.toSafeJSON = function toSafeJSON() { return { id: this._id.toString(), type: this.type, title: this.title, body: this.body, data: this.data, read: Boolean(this.readAt), readAt: this.readAt, createdAt: this.createdAt }; };

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Notification };
