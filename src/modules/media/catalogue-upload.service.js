const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { assertUserCanActById } = require('../users/user-status.service');
const { CatalogueUploadSession } = require('./catalogue-upload-session.model');
const { CatalogueMediaAsset } = require('./catalogue-media-asset.model');
const { getMediaProvider } = require('../../integrations/media');

function expectedPublicId(userId, businessId) {
  return `scovrr/catalogue/${businessId}/${userId}/${crypto.randomUUID()}`;
}

async function createSession({ userId, businessId, mimeType }) {
  await assertUserCanActById(userId);
  const maxBytes = mimeType.startsWith('video/') ? env.catalogueVideoMaxBytes : env.catalogueImageMaxBytes;
  const provider = getMediaProvider();
  const expectedProviderAssetId = expectedPublicId(userId, businessId);
  const upload = await provider.createPublicUploadSession({ publicId: expectedProviderAssetId, mimeType, maxBytes });
  const session = await CatalogueUploadSession.create({ userId, businessId, provider: upload.provider, expectedProviderAssetId, mimeType, maxBytes, expiresAt: upload.expiresAt });
  return { session: { id: session._id.toString(), provider: session.provider, mimeType: session.mimeType, maxBytes: session.maxBytes, expiresAt: session.expiresAt }, upload };
}

async function completeSession({ userId, businessId, sessionId, publicId, alt }) {
  await assertUserCanActById(userId);
  const session = await CatalogueUploadSession.findOne({ _id: sessionId, userId, businessId });
  if (!session) throw new AppError(404, 'CATALOGUE_UPLOAD_SESSION_NOT_FOUND', 'The catalogue upload session was not found');
  if (session.status === 'uploaded' && session.media?.url) {
    await CatalogueMediaAsset.updateOne(
      { uploadSessionId: session._id },
      { $setOnInsert: { uploadSessionId: session._id, businessId: session.businessId, uploadedBy: session.userId, provider: session.media.provider, publicId: session.media.publicId, url: session.media.url, mimeType: session.mimeType, format: session.media.format, bytes: session.media.bytes, alt: session.media.alt || alt || null } },
      { upsert: true }
    );
    return { url: session.media.url, provider: session.media.provider, publicId: session.media.publicId, mimeType: session.mimeType, alt: session.media.alt || alt || null, uploadSessionId: session._id.toString() };
  }
  if (session.status !== 'pending' || session.expiresAt <= new Date()) {
    if (session.status === 'pending') { session.status = 'expired'; await session.save(); }
    throw new AppError(409, 'CATALOGUE_UPLOAD_SESSION_EXPIRED', 'The catalogue upload session is no longer active');
  }
  const provider = getMediaProvider();
  let verified;
  try {
    verified = await provider.verifyPublicUploadedAsset({ publicId, expectedPublicId: session.expectedProviderAssetId, mimeType: session.mimeType, maxBytes: session.maxBytes });
  } catch (error) {
    try { await provider.deleteAsset({ providerAssetId: session.expectedProviderAssetId, mimeType: session.mimeType, type: 'upload' }); } catch (_cleanupError) { /* session TTL prevents the database reference from surviving */ }
    throw error;
  }
  session.status = 'uploaded';
  session.media = { url: verified.url, publicId: verified.publicId, provider: verified.provider, format: verified.format, bytes: verified.bytes, alt: alt || null };
  await session.save();
  await CatalogueMediaAsset.updateOne(
    { uploadSessionId: session._id },
    { $setOnInsert: { uploadSessionId: session._id, businessId: session.businessId, uploadedBy: session.userId, provider: verified.provider, publicId: verified.publicId, url: verified.url, mimeType: verified.mimeType, format: verified.format, bytes: verified.bytes, alt: alt || null } },
    { upsert: true }
  );
  return { url: verified.url, provider: verified.provider, publicId: verified.publicId, mimeType: verified.mimeType, alt: alt || null, uploadSessionId: session._id.toString() };
}

module.exports = { createSession, completeSession };
