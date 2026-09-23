const mongoose = require('mongoose');

function idOf(value) { return value?._id?.toString() || value?.toString() || null; }

const noteSchema = new mongoose.Schema({
  subjectType: { type: String, enum: ['report', 'moderation_case', 'dispute'], required: true, index: true },
  subjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  authorAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, trim: true, required: true, maxlength: 4_000 }
}, { timestamps: true, versionKey: false });

noteSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });

noteSchema.methods.toSafeJSON = function toSafeJSON() {
  return { id: this._id.toString(), subjectType: this.subjectType, subjectId: idOf(this.subjectId), authorAdminId: idOf(this.authorAdminId), author: this.authorAdminId?.email ? { firstName: this.authorAdminId.firstName, lastName: this.authorAdminId.lastName, email: this.authorAdminId.email } : null, body: this.body, createdAt: this.createdAt };
};

const OperationalNote = mongoose.model('OperationalNote', noteSchema);

module.exports = { OperationalNote };
