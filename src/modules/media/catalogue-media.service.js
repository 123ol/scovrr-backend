const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { CatalogueMediaAsset } = require('./catalogue-media-asset.model');
const { cloudinaryVideoPosterUrl } = require('./media-url');

function publicMedia(asset) {
  const posterUrl = String(asset.mimeType || '').startsWith('video/') ? cloudinaryVideoPosterUrl(asset.url) : null;
  return {
    url: asset.url,
    provider: asset.provider,
    mimeType: asset.mimeType,
    alt: asset.alt,
    order: asset.order || 0,
    ...(posterUrl ? { posterUrl } : {}),
    ...(asset.isCover !== undefined ? { isCover: Boolean(asset.isCover) } : {})
  };
}

async function sanitizeCatalogueMedia({ businessId, media = [], field = 'media', allowVideo = false }) {
  if (!media.length) return [];
  const sessionIds = [...new Set(media.map((asset) => asset.uploadSessionId).filter(Boolean))];
  if (sessionIds.length !== media.length || sessionIds.some((id) => !mongoose.isValidObjectId(id))) {
    throw new AppError(400, 'MEDIA_UPLOAD_REQUIRED', `${field} must use media uploaded through SCOVRR`);
  }
  const assets = await CatalogueMediaAsset.find({ uploadSessionId: { $in: sessionIds }, businessId }).lean();
  const byId = new Map(assets.map((asset) => [asset.uploadSessionId.toString(), asset]));
  return media.map((asset) => {
    const stored = byId.get(asset.uploadSessionId.toString());
    if (!stored?.url || asset.url !== stored.url || asset.publicId !== stored.publicId || asset.provider !== stored.provider || asset.mimeType !== stored.mimeType) {
      throw new AppError(400, 'MEDIA_UPLOAD_INVALID', `${field} contains media that was not verified for this business`);
    }
    if (!allowVideo && String(stored.mimeType || '').startsWith('video/')) throw new AppError(400, 'MEDIA_TYPE_NOT_ALLOWED', `${field} supports images only`);
    return publicMedia({ ...asset, url: stored.url, provider: stored.provider, publicId: stored.publicId, mimeType: stored.mimeType, alt: asset.alt || stored.alt || null });
  });
}

function assertPublishableCatalogueMedia(media = [], label = 'Catalogue item', { allowVideo = false } = {}) {
  if (!media.length) throw new AppError(400, 'MEDIA_REQUIRED', `${label} must include at least one verified image before publishing`);
  if (media.some((asset) => !/^https:\/\//i.test(String(asset.url || '')))) throw new AppError(400, 'MEDIA_INVALID', `${label} contains an invalid image URL`);
  if (!allowVideo && media.some((asset) => String(asset.mimeType || '').startsWith('video/'))) throw new AppError(400, 'MEDIA_TYPE_NOT_ALLOWED', `${label} supports images only`);
}

module.exports = { publicMedia, sanitizeCatalogueMedia, assertPublishableCatalogueMedia };
