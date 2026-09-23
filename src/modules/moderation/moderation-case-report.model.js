const mongoose = require('mongoose');

const linkSchema = new mongoose.Schema({
  caseId: { type: mongoose.Schema.Types.ObjectId, ref: 'ModerationCase', required: true, index: true },
  reportId: { type: mongoose.Schema.Types.ObjectId, ref: 'Report', required: true, index: true }
}, { timestamps: true, versionKey: false });

linkSchema.index({ caseId: 1, reportId: 1 }, { unique: true });

const ModerationCaseReport = mongoose.model('ModerationCaseReport', linkSchema);

module.exports = { ModerationCaseReport };
