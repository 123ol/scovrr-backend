const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { logger } = require('../../common/observability/logger');
const { User } = require('../users/user.model');
const { EmailVerificationChallenge } = require('./email-verification.model');
const emailService = require('../email/email.service');

const OTP_TTL_MS = 5 * 60 * 1_000;
const RESEND_COOLDOWN_MS = 60 * 1_000;
const RESEND_WINDOW_MS = 60 * 60 * 1_000;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS_PER_WINDOW = 5;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function generateOtp() {
  return String(crypto.randomInt(100_000, 1_000_000));
}

function hashOtp(email, code) {
  const pepper = env.emailOtpPepper || env.jwtRefreshSecret || 'scovrr-development-otp-pepper';
  return crypto.createHmac('sha256', pepper).update(`${normalizeEmail(email)}:${String(code)}`).digest('hex');
}

function matchesOtp(email, code, expectedHash) {
  const actual = Buffer.from(hashOtp(email, code), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function hashRequestIp(ipAddress) {
  return crypto.createHash('sha256').update(`${env.emailOtpPepper || env.jwtRefreshSecret || 'scovrr-development-ip-pepper'}:${String(ipAddress || '')}`).digest('hex');
}

function invalidCodeError() {
  return new AppError(400, 'EMAIL_VERIFICATION_INVALID', 'That verification code is invalid or has expired');
}

async function issueChallenge(user, { requestIp, resendCount = 0, resendWindowStartedAt = new Date() } = {}) {
  const now = new Date();
  await EmailVerificationChallenge.updateMany({ userId: user._id, purpose: 'registration', consumedAt: null }, { $set: { consumedAt: now } });
  const otp = generateOtp();
  const challenge = await EmailVerificationChallenge.create({
    userId: user._id,
    email: user.email,
    codeHash: hashOtp(user.email, otp),
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
    resendCount,
    resendWindowStartedAt,
    resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS),
    requestIpHash: requestIp ? hashRequestIp(requestIp) : null
  });
  try {
    await emailService.queueEmail({
      userId: user._id,
      toEmail: user.email,
      toName: `${user.firstName} ${user.lastName}`.trim(),
      templateKey: 'email_verification_otp',
      data: { firstName: user.firstName, otp, expiresMinutes: 5 },
      idempotencyKey: `email-otp:${user._id}:${challenge._id}`,
      metadata: { purpose: 'registration', userId: user._id.toString() }
    });
  } catch (error) {
    await EmailVerificationChallenge.deleteOne({ _id: challenge._id });
    throw error;
  }
  return challenge;
}

async function createChallenge(user, options = {}) {
  return issueChallenge(user, options);
}

async function resendChallenge(email, options = {}) {
  const normalized = normalizeEmail(email);
  const user = await User.findOne({ email: normalized });
  if (!user || user.status !== 'pending_verification') return { accepted: true };
  const latest = await EmailVerificationChallenge.findOne({ userId: user._id, purpose: 'registration' }).sort({ createdAt: -1 });
  const now = new Date();
  if (latest?.resendAvailableAt > now) return { accepted: true, resendAvailableAt: latest.resendAvailableAt };
  const windowStart = latest?.resendWindowStartedAt && now.getTime() - latest.resendWindowStartedAt.getTime() < RESEND_WINDOW_MS ? latest.resendWindowStartedAt : now;
  const count = latest?.resendWindowStartedAt === windowStart ? latest.resendCount + 1 : 1;
  if (count > MAX_RESENDS_PER_WINDOW) return { accepted: true, rateLimited: true };
  const challenge = await issueChallenge(user, { requestIp: options.requestIp, resendCount: count, resendWindowStartedAt: windowStart });
  return { accepted: true, challengeId: challenge._id.toString(), expiresAt: challenge.expiresAt, resendAvailableAt: challenge.resendAvailableAt };
}

async function verifyChallenge({ challengeId, email, code }) {
  const normalizedEmail = normalizeEmail(email);
  const challenge = await EmailVerificationChallenge.findOne({ _id: challengeId, email: normalizedEmail, purpose: 'registration', consumedAt: null }).select('+codeHash');
  if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= MAX_ATTEMPTS) throw invalidCodeError();
  if (!matchesOtp(normalizedEmail, code, challenge.codeHash)) {
    await EmailVerificationChallenge.updateOne({ _id: challenge._id, consumedAt: null, attempts: { $lt: MAX_ATTEMPTS } }, { $inc: { attempts: 1 } });
    throw invalidCodeError();
  }
  const consumed = await EmailVerificationChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, expiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
    { $set: { consumedAt: new Date() } },
    { new: true }
  );
  if (!consumed) throw invalidCodeError();
  const user = await User.findOneAndUpdate({ _id: challenge.userId, status: 'pending_verification' }, { $set: { status: 'active', emailVerifiedAt: new Date() } }, { new: true });
  if (!user) throw new AppError(409, 'ACCOUNT_UNAVAILABLE', 'This account is no longer available');
  try {
    await emailService.queueEmail({
      userId: user._id,
      toEmail: user.email,
      toName: `${user.firstName} ${user.lastName}`.trim(),
      templateKey: 'welcome',
      data: { firstName: user.firstName },
      idempotencyKey: `welcome:${user._id}`,
      metadata: { purpose: 'welcome', userId: user._id.toString() }
    });
  } catch (error) {
    logger.warn('email.welcome.queue_failed', { userId: user._id.toString(), error: { name: error.name, code: error.code, message: error.message } });
  }
  return user;
}

module.exports = { createChallenge, resendChallenge, verifyChallenge, generateOtp, hashOtp, matchesOtp, OTP_TTL_MS, RESEND_COOLDOWN_MS, MAX_ATTEMPTS };
