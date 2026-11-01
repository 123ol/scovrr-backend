const crypto = require('node:crypto');
const { env } = require('../../config/env');

function encryptionKey() {
  return crypto.createHash('sha256').update(env.emailOtpPepper || env.jwtRefreshSecret || 'scovrr-development-email-key').digest();
}

function encryptEmailPayload(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64url'), iv: iv.toString('base64url'), authTag: cipher.getAuthTag().toString('base64url') };
}

function decryptEmailPayload(encrypted) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(encrypted.iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

module.exports = { encryptEmailPayload, decryptEmailPayload };
