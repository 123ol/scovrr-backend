const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const cloudinaryProvider = require('./cloudinary.provider');

function getMediaProvider() {
  if (env.mediaProvider === 'cloudinary') return cloudinaryProvider;
  throw new AppError(503, 'MEDIA_PROVIDER_NOT_CONFIGURED', 'Media storage is not configured for this environment');
}

module.exports = { getMediaProvider };
