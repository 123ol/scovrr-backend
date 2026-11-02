const PUBLIC_CACHE_MAX_AGE_SECONDS = 30;
const PUBLIC_CACHE_STALE_SECONDS = 120;

const PUBLIC_READ_PATHS = [
  /^\/api\/v1\/products(?:\/|$)/,
  /^\/api\/v1\/services(?:\/|$)/,
  /^\/api\/v1\/categories$/,
  /^\/api\/v1\/businesses\/(?!mine(?:\/|$))[^/]+(?:\/products|\/services)?$/,
  /^\/api\/v1\/discover\/nearby$/
];

function isPublicReadPath(path = '') {
  return PUBLIC_READ_PATHS.some((pattern) => pattern.test(path));
}

function shouldCachePublicResponse(req) {
  return ['GET', 'HEAD'].includes(req.method) && !req.get('authorization') && isPublicReadPath(req.path);
}

function shouldNotStoreResponse(req) {
  return ['GET', 'HEAD'].includes(req.method) && !shouldCachePublicResponse(req);
}

function publicCacheHeaders(req, res, next) {
  if (shouldCachePublicResponse(req)) {
    res.set('Cache-Control', `public, max-age=${PUBLIC_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${PUBLIC_CACHE_STALE_SECONDS}`);
    res.set('Vary', 'Accept-Encoding, Origin');
  } else if (shouldNotStoreResponse(req)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Vary', 'Accept-Encoding, Origin');
  }
  return next();
}

module.exports = { PUBLIC_CACHE_MAX_AGE_SECONDS, PUBLIC_CACHE_STALE_SECONDS, isPublicReadPath, shouldCachePublicResponse, shouldNotStoreResponse, publicCacheHeaders };
