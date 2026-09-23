const mongoose = require('mongoose');

const disputeEventSchema = new mongoose.Schema({
  disputeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', required: true, index: true },
  type: { type: String, required: true, trim: true, maxlength: 100 },
  status: { type: String, trim: true, maxlength: 80, default: null },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  actorType: { type: String, enum: ['user', 'admin', 'business', 'system'], default: 'system' },
  note: { type: String, trim: true, maxlength: 4_000, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

disputeEventSchema.index({ disputeId: 1, createdAt: 1 });

disputeEventSchema.methods.toSafeJSON = function toSafeJSON(options = {}) {
  const result = { id: this._id.toString(), type: this.type, status: this.status, note: this.note, createdAt: this.createdAt };
  if (options.audience === 'admin') { result.actorId = this.actorId?.toString() || null; result.actorType = this.actorType; result.metadata = this.metadata; }
  return result;
};

const DisputeEvent = mongoose.model('DisputeEvent', disputeEventSchema);

module.exports = { DisputeEvent };
