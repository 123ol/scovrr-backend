const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { PlatformCommission } = require('../src/modules/payments/platform-commission.model');
const { calculateCommissionMinor, normalizeCommissionBps } = require('../src/modules/payments/platform-commission.service');
const { updatePlatformCommissionSchema } = require('../src/modules/payments/platform-commission.validation');
const { cloudinaryVideoPosterUrl } = require('../src/modules/media/media-url');

test('platform commission policy accepts bounded basis points, including zero', () => {
  assert.equal(normalizeCommissionBps(0), 0);
  assert.equal(normalizeCommissionBps(10_000), 10_000);
  assert.throws(() => normalizeCommissionBps(-1), (error) => error.code === 'INVALID_PLATFORM_COMMISSION');
  assert.throws(() => normalizeCommissionBps(10_001), (error) => error.code === 'INVALID_PLATFORM_COMMISSION');
});

test('commission calculation preserves the existing one-minor-unit seller floor', () => {
  assert.equal(calculateCommissionMinor(100_000, 1_000), 10_000);
  assert.equal(calculateCommissionMinor(100_000, 2_500), 25_000);
  assert.equal(calculateCommissionMinor(1, 10_000), 0);
  assert.equal(calculateCommissionMinor(100, 0), 0);
});

test('commission setting validation requires an auditable reason', () => {
  assert.equal(updatePlatformCommissionSchema.safeParse({ body: { commissionBps: '1250', reason: 'Launch pricing policy' }, params: {}, query: {} }).success, true);
  assert.equal(updatePlatformCommissionSchema.safeParse({ body: { commissionBps: 1250, reason: 'no' }, params: {}, query: {} }).success, false);
  assert.equal(updatePlatformCommissionSchema.safeParse({ body: { commissionBps: 10001, reason: 'Launch pricing policy' }, params: {}, query: {} }).success, false);
});

test('commission setting is additive and uniquely keyed without changing payment records', () => {
  const indexes = PlatformCommission.schema.indexes();
  assert.ok(indexes.some(([fields, options]) => fields.key && options.unique));
  assert.equal(PlatformCommission.schema.path('commissionBps').options.min, 0);
  assert.equal(PlatformCommission.schema.path('commissionBps').options.max, 10_000);
});

test('Cloudinary video media receives a bounded poster URL while other providers remain unchanged', () => {
  assert.equal(cloudinaryVideoPosterUrl('https://res.cloudinary.com/demo/video/upload/v1234/scovrr/post.mp4', 480), 'https://res.cloudinary.com/demo/video/upload/so_0,f_jpg,q_auto,w_480,c_limit/v1234/scovrr/post.jpg');
  assert.equal(cloudinaryVideoPosterUrl('https://cdn.example.com/post.mp4'), null);
});

test('mobile video delivery uses a bounded viewport-aware Cloudinary width', () => {
  const mediaSource = fs.readFileSync(require.resolve('../../app/src/services/media.js'), 'utf8');
  const videoFeedSource = fs.readFileSync(require.resolve('../../app/app/(consumer)/video-feed.jsx'), 'utf8');
  assert.match(mediaSource, /responsiveMediaWidth\(viewportWidth, density = 2/);
  assert.match(mediaSource, /Math\.min\(3, Number\(density\)/);
  assert.match(videoFeedSource, /responsiveMediaWidth\(width, PixelRatio\.get\(\)\)/);
  assert.match(videoFeedSource, /optimizeCloudinaryUrl\(video\.url, \{ width: videoWidth, video: true \}\)/);
  assert.match(videoFeedSource, /cloudinaryVideoPosterUrl\(video\.url, \{ width: videoWidth \}\)/);
  assert.match(videoFeedSource, /poster \? optimizeCloudinaryUrl\(poster, \{ width: videoWidth \}\) : null/);
});

test('mobile media optimization augments existing Cloudinary transforms when width is missing', () => {
  const mediaSource = fs.readFileSync(require.resolve('../../app/src/services/media.js'), 'utf8');
  assert.match(mediaSource, /firstSegment/);
  assert.match(mediaSource, /\(\^\|,\)w_\\d\+\(,\|\$\)/);
  assert.match(mediaSource, /updatedSegment = `\$\{firstSegment\},w_\$\{safeWidth\}`/);
  assert.match(mediaSource, /replace\(`\/upload\/\$\{firstSegment\}\/`, `\/upload\/\$\{updatedSegment\}\/`\)/);
});

test('mobile video surfaces observe power state and pause autoplay in low-power mode', () => {
  const powerSource = fs.readFileSync(require.resolve('../../app/src/services/power.js'), 'utf8');
  const videoFeedSource = fs.readFileSync(require.resolve('../../app/app/(consumer)/video-feed.jsx'), 'utf8');
  const creatorSource = fs.readFileSync(require.resolve('../../app/app/(business)/content-post.jsx'), 'utf8');
  assert.match(powerSource, /getPowerStateAsync/);
  assert.match(powerSource, /addLowPowerModeListener/);
  assert.match(powerSource, /shouldConstrainVideo/);
  assert.match(videoFeedSource, /subscribePowerState/);
  assert.match(videoFeedSource, /!powerConstrained && activeIndex === index/);
  assert.match(creatorSource, /shouldConstrainVideo\(powerState\)/);
});
