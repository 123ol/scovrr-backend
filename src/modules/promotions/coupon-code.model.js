const mongoose = require('mongoose');

const couponCodeSchema = new mongoose.Schema({
  promotionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Promotion', required: true, index: true },
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
  code: { type: String, required: true, trim: true, uppercase: true, minlength: 3, maxlength: 40 },
  source: { type: String, enum: ['custom', 'generated'], default: 'custom' },
  active: { type: Boolean, default: true, index: true },
  disabledAt: { type: Date, default: null },
  disabledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true, versionKey: false });

couponCodeSchema.index({ code: 1 }, { unique: true });
couponCodeSchema.index({ businessId: 1, active: 1, code: 1 });

couponCodeSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), promotionId: this.promotionId.toString(), businessId: this.businessId.toString(), code: this.code, source: this.source, active: this.active, createdAt: this.createdAt, updatedAt: this.updatedAt };
};

const CouponCode = mongoose.model('CouponCode', couponCodeSchema);
module.exports = { CouponCode };
