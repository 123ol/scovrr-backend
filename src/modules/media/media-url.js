function cloudinaryVideoPosterUrl(url, width = 720) {
  const value = String(url || '');
  if (!/^https:\/\/res\.cloudinary\.com\//i.test(value) || !value.includes('/video/upload/')) return null;
  const [prefix, afterUpload] = value.split('/video/upload/');
  const segments = String(afterUpload || '').split('/').filter(Boolean);
  if (!segments.length) return null;
  if (/^(?:f_|q_|vc_|w_|c_|so_)/i.test(segments[0]) || segments[0].includes(',')) segments.shift();
  if (!segments.length) return null;
  const safeWidth = Math.max(160, Math.min(2_160, Math.round(Number(width) || 720)));
  const sourcePath = segments.join('/').replace(/\.[a-z0-9]+$/i, '.jpg');
  return `${prefix}/video/upload/so_0,f_jpg,q_auto,w_${safeWidth},c_limit/${sourcePath}`;
}

module.exports = { cloudinaryVideoPosterUrl };
