const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { createOpaqueToken, hashToken } = require('../../common/security/tokens');
const { User } = require('../users/user.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { RefreshSession } = require('./refresh-session.model');
const { Address } = require('../addresses/address.model');
const { Favorite } = require('../favorites/favorite.model');
const { Follow } = require('../follows/follow.model');
const { UserFollow } = require('../follows/user-follow.model');
const { Order } = require('../orders/order.model');
const { Booking } = require('../bookings/booking.model');
const { Conversation } = require('../conversations/conversation.model');
const { Message } = require('../conversations/message.model');
const { AccountExportJob } = require('./account-export-job.model');
const { AccountDeletionRequest } = require('./account-deletion-request.model');
const { enqueueJob } = require('../../jobs/job.service');
const { logger } = require('../../common/observability/logger');

const BCRYPT_ROUNDS = 12;

function getRefreshExpiryDate() {
  const days = Number.parseInt(env.jwtRefreshExpiresIn, 10);
  const durationDays = Number.isFinite(days) && days > 0 ? days : 30;
  return new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
}

function createAccessToken(user, sessionId) {
  return jwt.sign({
    sub: user._id.toString(),
    sid: sessionId.toString(),
    typ: 'access'
  }, env.jwtAccessSecret, { expiresIn: env.jwtAccessExpiresIn });
}

async function createSession(user, metadata = {}) {
  const refreshToken = createOpaqueToken();
  const session = await RefreshSession.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshExpiryDate(),
    userAgent: metadata.userAgent,
    ipAddress: metadata.ipAddress,
    deviceLabel: metadata.deviceLabel || null,
    platform: metadata.platform || 'unknown',
    lastUsedAt: new Date()
  });

  return {
    accessToken: createAccessToken(user, session._id),
    refreshToken,
    expiresAt: session.expiresAt
  };
}

async function ensureSellerAccountType(user) {
  if (user.accountType === 'seller') return user;
  const hasBusiness = await BusinessMembership.exists({ userId: user._id, status: 'active' });
  if (hasBusiness) {
    user.accountType = 'seller';
    await user.save();
  }
  return user;
}

function publicSession(user, tokens) {
  return { user: user.toSafeJSON(), ...tokens };
}

async function register(input, metadata) {
  if (input.accountType === 'seller' && !input.location) {
    throw new AppError(400, 'SELLER_LOCATION_REQUIRED', 'Seller accounts require a saved location');
  }
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone || undefined,
    accountType: input.accountType || 'buyer',
    location: input.location || undefined,
    passwordHash
  });
  await require('../analytics/domain-event.service').queue('USER_REGISTERED', { userId: user._id, actorType: 'user', entityType: 'user', entityId: user._id, metadata: { source: 'API' } }, `user:${user._id}:registered`);
  const tokens = await createSession(user, metadata);
  return publicSession(user, tokens);
}

async function login(input, metadata) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const valid = user && await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  }

  await ensureSellerAccountType(user);
  const deviceFilter = { user: user._id, platform: metadata?.platform || 'unknown', ...(metadata?.deviceLabel ? { deviceLabel: metadata.deviceLabel } : { userAgent: metadata?.userAgent || null }) };
  const knownDevice = await RefreshSession.exists(deviceFilter);

  user.lastLoginAt = new Date();
  await user.save();
  await require('../analytics/domain-event.service').queue('USER_LOGIN_SUCCEEDED', { userId: user._id, actorType: 'user', entityType: 'user', entityId: user._id, metadata: { source: 'API' } }, `user:${user._id}:login:${user.lastLoginAt.toISOString()}`);
  const tokens = await createSession(user, metadata);
  if (!knownDevice) {
    try {
      const { createNotification } = require('../notifications/notification.service');
      await createNotification({ userId: user._id, type: 'security_new_login', title: 'New sign-in detected', body: `Your SCOVRR account was just signed in from a new ${metadata?.platform || 'device'}. Review your signed-in devices if this was not you.`, data: { platform: metadata?.platform || 'unknown', signedInAt: new Date().toISOString() } });
    } catch (error) {
      logger.warn('auth.security_notification.failed', { error: { name: error.name, code: error.code, message: error.message } });
    }
  }
  return publicSession(user, tokens);
}

async function refresh(refreshToken, metadata) {
  const now = new Date();
  const session = await RefreshSession.findOneAndUpdate(
    { tokenHash: hashToken(refreshToken), revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
    { new: true }
  );

  if (!session) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'The refresh session is invalid or expired');
  }

  const user = await User.findById(session.user);
  if (!user || user.status !== 'active') {
    throw new AppError(401, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  }

  await ensureSellerAccountType(user);
  const tokens = await createSession(user, metadata);
  const replacement = await RefreshSession.findOne({ tokenHash: hashToken(tokens.refreshToken) }).select('_id');
  session.replacedBy = replacement?._id || null;
  await session.save();
  return publicSession(user, tokens);
}

function safeSessionJSON(session, currentSessionId = null) {
  return {
    id: session._id.toString(),
    deviceLabel: session.deviceLabel || (session.platform === 'unknown' ? 'Unknown device' : `${session.platform} device`),
    platform: session.platform || 'unknown',
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt || session.createdAt,
    expiresAt: session.expiresAt,
    current: currentSessionId ? session._id.toString() === currentSessionId.toString() : false
  };
}

async function listSessions(userId, currentSessionId = null) {
  const sessions = await RefreshSession.find({ user: userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .limit(25);
  return sessions.map((session) => safeSessionJSON(session, currentSessionId));
}

async function revokeSession(userId, sessionId) {
  const result = await RefreshSession.updateOne(
    { _id: sessionId, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  if (!result.matchedCount) throw new AppError(404, 'SESSION_NOT_FOUND', 'This session is no longer active');
}

async function revokeOtherSessions(userId, currentSessionId) {
  const result = await RefreshSession.updateMany(
    { user: userId, _id: { $ne: currentSessionId }, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
  return result.modifiedCount || 0;
}

async function logout(sessionId, userId) {
  await RefreshSession.updateOne(
    { _id: sessionId, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

async function updateProfile(userId, input) {
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  if (user.accountType === 'seller' && input.location === null) {
    throw new AppError(400, 'SELLER_LOCATION_REQUIRED', 'Seller accounts must keep a saved location');
  }
  if (input.phone !== undefined && input.phone !== null) {
    const existing = await User.findOne({ phone: input.phone, _id: { $ne: userId } }).select('_id');
    if (existing) throw new AppError(409, 'PHONE_ALREADY_REGISTERED', 'This phone number is already in use');
  }
  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.phone !== undefined) user.phone = input.phone || undefined;
  if (input.location !== undefined) user.location = input.location;
  await user.save();
  return user;
}

async function updateNotificationPreferences(userId, input) {
  const user = await User.findOne({ _id: userId, status: 'active' });
  if (!user) throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  user.notificationPreferences = { ...(user.notificationPreferences?.toObject?.() || user.notificationPreferences || {}), ...input };
  await user.save();
  return user;
}

async function recordPrivacyConsent(userId, input) {
  if (input.policyVersion !== env.privacyPolicyVersion) {
    throw new AppError(409, 'PRIVACY_POLICY_VERSION_UNAVAILABLE', 'This privacy policy version is no longer current');
  }
  const user = await User.findOne({ _id: userId, status: 'active' });
  if (!user) throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  user.privacyConsent = { policyVersion: input.policyVersion, acceptedAt: new Date(), source: 'settings' };
  await user.save();
  return user;
}

async function getPrivacyConsent(userId) {
  const user = await User.findOne({ _id: userId, status: 'active' }).select('privacyConsent');
  if (!user) throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  return { currentPolicyVersion: env.privacyPolicyVersion, consent: user.privacyConsent?.acceptedAt ? { policyVersion: user.privacyConsent.policyVersion, acceptedAt: user.privacyConsent.acceptedAt } : null };
}

function getAccountLifecyclePolicy() {
  return {
    version: env.privacyPolicyVersion,
    deactivation: { enabled: true, destructive: false, sessionRevocation: true, supportRecoveryRequired: true },
    deletionRequest: { enabled: true, statuses: ['requested', 'under_review', 'rejected', 'cancelled'], execution: 'manual_review_required', automaticDeletionEnabled: false },
    retention: { automaticDeletionEnabled: false, policyApprovalRequired: true, recordsRetainedUntilApprovedWorkflow: true }
  };
}

async function requestAccountDeletion(userId, reason = null) {
  const user = await User.findOne({ _id: userId, status: 'active' }).select('_id status');
  if (!user) throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  const active = await AccountDeletionRequest.findOne({ userId, status: { $in: ['requested', 'under_review'] } }).sort({ requestedAt: -1 });
  if (active) return active;
  try {
    return await AccountDeletionRequest.create({ userId, reason: reason || null });
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await AccountDeletionRequest.findOne({ userId, status: { $in: ['requested', 'under_review'] } }).sort({ requestedAt: -1 });
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

async function getAccountDeletionRequest(userId) {
  return AccountDeletionRequest.findOne({ userId }).sort({ requestedAt: -1 });
}

async function cancelAccountDeletionRequest(userId) {
  const request = await AccountDeletionRequest.findOneAndUpdate(
    { userId, status: 'requested' },
    { $set: { status: 'cancelled', reviewedAt: new Date(), resolutionReason: 'Cancelled by account owner' } },
    { new: true }
  );
  if (!request) throw new AppError(409, 'DELETION_REQUEST_NOT_CANCELLABLE', 'Only a pending deletion request can be cancelled');
  return request;
}

async function listAccountDeletionRequests({ status, page, limit }) {
  const filter = status ? { status } : {};
  const skip = (page - 1) * limit;
  const [requests, total] = await Promise.all([
    AccountDeletionRequest.find(filter).sort({ requestedAt: -1 }).skip(skip).limit(limit).populate('userId', 'firstName lastName email accountType status'),
    AccountDeletionRequest.countDocuments(filter)
  ]);
  return {
    requests: requests.map((request) => ({ ...request.toSafeJSON(), user: request.userId?.email ? { id: request.userId._id.toString(), firstName: request.userId.firstName, lastName: request.userId.lastName, email: request.userId.email, accountType: request.userId.accountType, status: request.userId.status } : null })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit)
  };
}

async function reviewAccountDeletionRequest(actorId, requestId, action, reason) {
  const request = await AccountDeletionRequest.findById(requestId);
  if (!request) throw new AppError(404, 'DELETION_REQUEST_NOT_FOUND', 'Account deletion request not found');
  if (!['requested', 'under_review'].includes(request.status)) throw new AppError(409, 'DELETION_REQUEST_CLOSED', 'This account deletion request is already closed');
  request.status = action === 'start_review' ? 'under_review' : 'rejected';
  request.reviewedAt = new Date();
  request.reviewedBy = actorId;
  request.resolutionReason = reason;
  await request.save();
  return request;
}

async function exportAccountData(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  const [addresses, favorites, follows, userFollows, orders, bookings, conversations] = await Promise.all([
    Address.find({ userId }).sort({ createdAt: -1 }).limit(500),
    Favorite.find({ userId }).sort({ createdAt: -1 }).limit(500),
    Follow.find({ userId }).sort({ createdAt: -1 }).limit(500),
    UserFollow.find({ followerId: userId }).sort({ createdAt: -1 }).limit(500),
    Order.find({ customerId: userId }).sort({ createdAt: -1 }).limit(500),
    Booking.find({ customerId: userId }).sort({ createdAt: -1 }).limit(500),
    Conversation.find({ participantIds: userId }).sort({ updatedAt: -1 }).limit(100)
  ]);
  const messages = await Promise.all(conversations.map(async (conversation) => ({
    conversationId: conversation._id.toString(),
    messages: (await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 }).limit(500)).map((item) => item.toSafeJSON())
  })));
  return {
    exportedAt: new Date().toISOString(),
    profile: user.toSafeJSON(),
    notificationPreferences: user.notificationPreferences,
    addresses: addresses.map((item) => item.toSafeJSON()),
    favorites: favorites.map((item) => ({ targetType: item.targetType, targetId: item.targetId.toString(), createdAt: item.createdAt })),
    follows: follows.map((item) => ({ businessId: item.businessId.toString(), createdAt: item.createdAt })),
    followedUsers: userFollows.map((item) => ({ userId: item.followedUserId.toString(), createdAt: item.createdAt })),
    orders: orders.map((item) => item.toSafeJSON()),
    bookings: bookings.map((item) => ({ ...item.toSafeJSON(), customerId: item.customerId.toString() })),
    conversations: conversations.map((item) => item.toSafeJSON(userId)),
    messages
  };
}

async function requestAccountExport(userId) {
  const active = await AccountExportJob.findOne({ userId, status: { $in: ['queued', 'processing'] }, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (active) return active;
  const job = await AccountExportJob.create({ userId, status: 'queued', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000) });
  try {
    await enqueueJob({ type: 'account_export', payload: { exportJobId: job._id.toString() }, idempotencyKey: `account-export:${job._id}` });
  } catch (error) {
    job.status = 'failed';
    job.errorCode = 'EXPORT_QUEUE_UNAVAILABLE';
    await job.save();
    logger.error('account_export.enqueue.failed', { exportJobId: job._id.toString(), error: { name: error.name, code: error.code, message: error.message } });
    throw new AppError(503, 'EXPORT_QUEUE_UNAVAILABLE', 'Your export could not be queued. Please try again.');
  }
  return job;
}

async function processAccountExport(exportJobId) {
  const job = await AccountExportJob.findOneAndUpdate({ _id: exportJobId, status: 'queued', expiresAt: { $gt: new Date() } }, { $set: { status: 'processing', startedAt: new Date() } }, { new: true });
  if (!job) return null;
  try {
    const document = await exportAccountData(job.userId);
    job.document = document;
    job.status = 'completed';
    job.completedAt = new Date();
    await job.save();
  } catch (error) {
    job.status = 'failed';
    job.errorCode = error.code || 'EXPORT_FAILED';
    await job.save();
    logger.error('account_export.process.failed', { exportJobId: job._id.toString(), error: { name: error.name, code: error.code, message: error.message } });
  }
  return job;
}

async function getAccountExport(userId, exportJobId) {
  const job = await AccountExportJob.findOne({ _id: exportJobId, userId });
  if (!job) throw new AppError(404, 'EXPORT_NOT_FOUND', 'Export not found or expired');
  return job;
}

async function deactivateAccount(userId, reason = null) {
  const now = new Date();
  const user = await User.findOneAndUpdate({ _id: userId, status: 'active' }, { $set: { status: 'deactivated', deactivatedAt: now, deactivationReason: reason || null } }, { new: true });
  if (!user) throw new AppError(409, 'ACCOUNT_NOT_ACTIVE', 'This account is already unavailable');
  await RefreshSession.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: now } });
  return user;
}

module.exports = { register, login, refresh, logout, listSessions, revokeSession, revokeOtherSessions, ensureSellerAccountType, updateProfile, updateNotificationPreferences, recordPrivacyConsent, getPrivacyConsent, getAccountLifecyclePolicy, requestAccountDeletion, getAccountDeletionRequest, cancelAccountDeletionRequest, listAccountDeletionRequests, reviewAccountDeletionRequest, exportAccountData, requestAccountExport, processAccountExport, getAccountExport, deactivateAccount, safeSessionJSON };
