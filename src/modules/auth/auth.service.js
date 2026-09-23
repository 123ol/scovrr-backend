const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { createOpaqueToken, hashToken } = require('../../common/security/tokens');
const { User } = require('../users/user.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { RefreshSession } = require('./refresh-session.model');

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
    ipAddress: metadata.ipAddress
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

  user.lastLoginAt = new Date();
  await user.save();
  await require('../analytics/domain-event.service').queue('USER_LOGIN_SUCCEEDED', { userId: user._id, actorType: 'user', entityType: 'user', entityId: user._id, metadata: { source: 'API' } }, `user:${user._id}:login:${user.lastLoginAt.toISOString()}`);
  const tokens = await createSession(user, metadata);
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

async function logout(sessionId, userId) {
  await RefreshSession.updateOne(
    { _id: sessionId, user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
}

async function updateProfile(userId, input) {
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'This account is not available');
  if (input.phone !== undefined && input.phone !== null) {
    const existing = await User.findOne({ phone: input.phone, _id: { $ne: userId } }).select('_id');
    if (existing) throw new AppError(409, 'PHONE_ALREADY_REGISTERED', 'This phone number is already in use');
  }
  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.phone !== undefined) user.phone = input.phone || undefined;
  await user.save();
  return user;
}

module.exports = { register, login, refresh, logout, ensureSellerAccountType, updateProfile };
