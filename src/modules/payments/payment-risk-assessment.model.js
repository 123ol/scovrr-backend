const mongoose = require('mongoose');

const RISK_DECISIONS = ['allow', 'review'];

const paymentRiskAssessmentSchema = new mongoose.Schema({
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
  type: { type: String, enum: ['order', 'booking', 'subscription', 'promotion'], required: true, index: true },
  score: { type: Number, min: 0, max: 100, required: true },
  decision: { type: String, enum: RISK_DECISIONS, required: true, index: true },
  flags: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
  source: { type: String, required: true, default: 'deterministic-v1', maxlength: 80 },
  assessedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true, versionKey: false });

paymentRiskAssessmentSchema.index({ decision: 1, createdAt: -1 });
paymentRiskAssessmentSchema.index({ customerId: 1, createdAt: -1 });

paymentRiskAssessmentSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    paymentId: this.paymentId.toString(),
    customerId: this.customerId.toString(),
    businessId: this.businessId?.toString() || null,
    type: this.type,
    score: this.score,
    decision: this.decision,
    flags: this.flags,
    source: this.source,
    assessedAt: this.assessedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

const PaymentRiskAssessment = mongoose.model('PaymentRiskAssessment', paymentRiskAssessmentSchema);

module.exports = { PaymentRiskAssessment, RISK_DECISIONS };
