const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');

const SAFE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAFE_CATALOGUE_MEDIA_MIME_TYPES = new Set([...SAFE_IMAGE_MIME_TYPES, 'video/mp4', 'video/quicktime', 'video/webm']);

function resourceTypeForMime(mimeType) {
  return String(mimeType || '').startsWith('video/') ? 'video' : 'image';
}

function isConfigured(configuration = env) {
  return configuration.mediaProvider === 'cloudinary' && Boolean(configuration.cloudinaryCloudName && configuration.cloudinaryApiKey && configuration.cloudinaryApiSecret);
}

function ensureConfigured(configuration = env) {
  if (!isConfigured(configuration)) {
    throw new AppError(503, 'MEDIA_PROVIDER_NOT_CONFIGURED', 'Media storage is not configured for this environment');
  }
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function signParams(params) {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return sha1(`${serialized}${env.cloudinaryApiSecret}`);
}

function providerAssetId(publicId) {
  return publicId;
}

async function createUploadSession({ publicId, mimeType, maxBytes }) {
  ensureConfigured();
  if (!SAFE_IMAGE_MIME_TYPES.has(mimeType)) throw new AppError(400, 'UNSUPPORTED_EVIDENCE_TYPE', 'Only JPEG, PNG, and WEBP evidence is supported');
  const timestamp = Math.floor(Date.now() / 1_000);
  const params = { public_id: publicId, timestamp, type: 'authenticated' };
  return {
    provider: 'cloudinary',
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`,
    fields: { ...params, api_key: env.cloudinaryApiKey, signature: signParams(params) },
    maxBytes,
    expiresAt: new Date((timestamp + 900) * 1_000)
  };
}

async function createPublicUploadSession({ publicId, mimeType, maxBytes }) {
  ensureConfigured();
  if (!SAFE_CATALOGUE_MEDIA_MIME_TYPES.has(mimeType)) throw new AppError(400, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WEBP, MP4, MOV, and WEBM catalogue media is supported');
  const timestamp = Math.floor(Date.now() / 1_000);
  const params = { public_id: publicId, timestamp };
  const resourceType = resourceTypeForMime(mimeType);
  return {
    provider: 'cloudinary',
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/${resourceType}/upload`,
    fields: { ...params, api_key: env.cloudinaryApiKey, signature: signParams(params) },
    maxBytes,
    expiresAt: new Date((timestamp + 900) * 1_000)
  };
}

async function cloudinaryRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch (_error) { body = { raw: text }; }
  if (!response.ok) throw new AppError(502, 'MEDIA_PROVIDER_ERROR', 'The media provider could not complete the request', { providerStatus: response.status, providerBody: body });
  return body;
}

async function verifyUploadedAsset({ publicId, expectedPublicId, mimeType, maxBytes }) {
  ensureConfigured();
  if (publicId !== expectedPublicId) throw new AppError(400, 'UPLOAD_ASSET_MISMATCH', 'The uploaded object does not belong to this upload session');
  if (!SAFE_IMAGE_MIME_TYPES.has(mimeType)) throw new AppError(400, 'UNSUPPORTED_EVIDENCE_TYPE', 'Only JPEG, PNG, and WEBP evidence is supported');
  const endpoint = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/resources/image/authenticated/${encodeURIComponent(publicId)}`;
  const metadata = await cloudinaryRequest(endpoint, { headers: { Authorization: `Basic ${Buffer.from(`${env.cloudinaryApiKey}:${env.cloudinaryApiSecret}`).toString('base64')}` } });
  if (metadata.public_id !== expectedPublicId || metadata.resource_type !== 'image' || metadata.type !== 'authenticated') throw new AppError(400, 'UPLOAD_ASSET_UNVERIFIED', 'The media provider metadata could not be verified');
  if (!Number.isInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > maxBytes) throw new AppError(400, 'EVIDENCE_SIZE_INVALID', 'The uploaded evidence exceeds the configured size limit');
  const formatMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[String(metadata.format || '').toLowerCase()];
  if (!formatMime || formatMime !== mimeType) throw new AppError(400, 'EVIDENCE_MIME_MISMATCH', 'The uploaded file type does not match its declared type');
  return { provider: 'cloudinary', providerAssetId: providerAssetId(metadata.public_id), storageKey: `cloudinary:authenticated:${metadata.public_id}`, publicId: metadata.public_id, version: metadata.version || null, format: metadata.format, mimeType: formatMime, bytes: metadata.bytes };
}

async function verifyPublicUploadedAsset({ publicId, expectedPublicId, mimeType, maxBytes }) {
  ensureConfigured();
  if (publicId !== expectedPublicId) throw new AppError(400, 'UPLOAD_ASSET_MISMATCH', 'The uploaded object does not belong to this upload session');
  if (!SAFE_CATALOGUE_MEDIA_MIME_TYPES.has(mimeType)) throw new AppError(400, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG, WEBP, MP4, MOV, and WEBM catalogue media is supported');
  const resourceType = resourceTypeForMime(mimeType);
  const endpoint = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/resources/${resourceType}/upload/${encodeURIComponent(publicId)}`;
  const metadata = await cloudinaryRequest(endpoint, { headers: { Authorization: `Basic ${Buffer.from(`${env.cloudinaryApiKey}:${env.cloudinaryApiSecret}`).toString('base64')}` } });
  if (metadata.public_id !== expectedPublicId || metadata.resource_type !== resourceType || metadata.type !== 'upload' || !/^https:\/\//i.test(String(metadata.secure_url || ''))) throw new AppError(400, 'UPLOAD_ASSET_UNVERIFIED', 'The media provider metadata could not be verified');
  if (!Number.isInteger(metadata.bytes) || metadata.bytes < 1 || metadata.bytes > maxBytes) throw new AppError(400, 'MEDIA_SIZE_INVALID', 'The uploaded media exceeds the configured size limit');
  const formatMime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }[String(metadata.format || '').toLowerCase()];
  if (!formatMime || formatMime !== mimeType) throw new AppError(400, 'MEDIA_MIME_MISMATCH', 'The uploaded file type does not match its declared type');
  return { provider: 'cloudinary', providerAssetId: providerAssetId(metadata.public_id), publicId: metadata.public_id, url: metadata.secure_url, format: metadata.format, mimeType: formatMime, resourceType, bytes: metadata.bytes, version: metadata.version || null };
}

function createAccessUrl(asset, ttlSeconds) {
  ensureConfigured();
  if (!asset.format) throw new AppError(409, 'EVIDENCE_PREVIEW_UNAVAILABLE', 'This evidence does not have a provider format yet');
  const timestamp = Math.floor(Date.now() / 1_000);
  const expiresAt = timestamp + ttlSeconds;
  const params = { public_id: asset.providerAssetId, format: asset.format, type: 'authenticated', expires_at: expiresAt, timestamp };
  const query = new URLSearchParams({ ...params, api_key: env.cloudinaryApiKey, signature: signParams(params) });
  return { url: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/download?${query.toString()}`, expiresAt: new Date(expiresAt * 1_000) };
}

async function deleteAsset(asset) {
  ensureConfigured();
  const timestamp = Math.floor(Date.now() / 1_000);
  const params = { public_id: asset.providerAssetId, timestamp, type: asset.type || 'authenticated', invalidate: true };
  const body = new URLSearchParams({ ...params, api_key: env.cloudinaryApiKey, signature: signParams(params) });
  const resourceType = asset.resourceType || resourceTypeForMime(asset.mimeType);
  await cloudinaryRequest(`https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/${resourceType}/destroy`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}

module.exports = { createUploadSession, verifyUploadedAsset, createPublicUploadSession, verifyPublicUploadedAsset, createAccessUrl, deleteAsset, isConfigured, ensureConfigured, SAFE_IMAGE_MIME_TYPES, SAFE_CATALOGUE_MEDIA_MIME_TYPES };
