const mongoose = require('mongoose');

const platformCommissionSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, immutable: true, default: 'platform_commission_bps' },
  commissionBps: { type: Number, required: true, min: 0, max: 10_000 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason: { type: String, trim: true, maxlength: 2_000, default: null }
}, { timestamps: true, versionKey: false });

platformCommissionSchema.methods.toSafeJSON = function toSafeJSON(source = 'database') {
  return {
    key: this.key,
    commissionBps: this.commissionBps,
    commissionPercent: Number((this.commissionBps / 100).toFixed(2)),
    source,
    updatedAt: this.updatedAt,
    updatedBy: this.updatedBy?.toString?.() || null
  };
};

const PlatformCommission = mongoose.model('PlatformCommission', platformCommissionSchema);

module.exports = { PlatformCommission };
