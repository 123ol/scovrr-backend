const mongoose = require('mongoose');

const projectionEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  projectedAt: { type: Date, default: Date.now }
}, { timestamps: true, versionKey: false });

const AnalyticsProjectionEvent = mongoose.model('AnalyticsProjectionEvent', projectionEventSchema);
module.exports = { AnalyticsProjectionEvent };
