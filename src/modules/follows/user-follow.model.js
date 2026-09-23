const mongoose = require('mongoose');

const userFollowSchema = new mongoose.Schema({
  followerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  followedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
}, { timestamps: true, versionKey: false });

userFollowSchema.index({ followerId: 1, followedUserId: 1 }, { unique: true });

const UserFollow = mongoose.model('UserFollow', userFollowSchema);

module.exports = { UserFollow };
