const crypto = require('node:crypto');

function createOpaqueToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { createOpaqueToken, hashToken };
