const mongoose = require('mongoose');

const metricDedupeSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true, maxlength: 300 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, versionKey: false });
metricDedupeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AnalyticsMetricDedupe = mongoose.model('AnalyticsMetricDedupe', metricDedupeSchema);
module.exports = { AnalyticsMetricDedupe };
