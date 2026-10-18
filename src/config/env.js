const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const toNonNegativeInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const toBoolean = (value, fallback = false) => value === undefined ? fallback : ['1', 'true', 'yes'].includes(String(value).toLowerCase());

const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toPositiveInt(process.env.PORT, 4000),
  mongodbUri: process.env.MONGODB_URI || '',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || '',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY || '',
  paystackPublicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
  paymentCallbackUrl: process.env.PAYMENT_CALLBACK_URL || '',
  platformCommissionBps: toPositiveInt(process.env.PLATFORM_COMMISSION_BPS, 1000),
  payoutHoldDays: toPositiveInt(process.env.PAYOUT_HOLD_DAYS, 7),
  payoutProvider: process.env.PAYOUT_PROVIDER || 'paystack',
  disputeOrderWindowDays: toPositiveInt(process.env.DISPUTE_ORDER_WINDOW_DAYS, 14),
  disputeBookingWindowDays: toPositiveInt(process.env.DISPUTE_BOOKING_WINDOW_DAYS, 7),
  disputeResponseWindowDays: toPositiveInt(process.env.DISPUTE_RESPONSE_WINDOW_DAYS, 3),
  autoPayoutsEnabled: toBoolean(process.env.AUTO_PAYOUTS_ENABLED),
  reconciliationEnabled: toBoolean(process.env.RECONCILIATION_ENABLED),
  cronSecret: process.env.CRON_SECRET || '',
  jobPollIntervalMs: toPositiveInt(process.env.JOB_POLL_INTERVAL_MS, 1_000),
  jobRecurringIntervalMs: toPositiveInt(process.env.JOB_RECURRING_INTERVAL_MS, 60_000),
  slowRequestMs: toPositiveInt(process.env.SLOW_REQUEST_MS, 1_000),
  slowDatabaseQueryMs: toPositiveInt(process.env.SLOW_DATABASE_QUERY_MS, 500),
  databaseCommandMonitoringEnabled: toBoolean(process.env.DATABASE_COMMAND_MONITORING_ENABLED, true),
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || '',
  mediaProvider: process.env.MEDIA_PROVIDER || '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',
  evidenceImageMaxBytes: toPositiveInt(process.env.EVIDENCE_IMAGE_MAX_BYTES, 10 * 1024 * 1024),
  catalogueImageMaxBytes: toPositiveInt(process.env.CATALOGUE_IMAGE_MAX_BYTES, 10 * 1024 * 1024),
  catalogueVideoMaxBytes: toPositiveInt(process.env.CATALOGUE_VIDEO_MAX_BYTES, 50 * 1024 * 1024),
  evidenceDocumentMaxBytes: toPositiveInt(process.env.EVIDENCE_DOCUMENT_MAX_BYTES, 15 * 1024 * 1024),
  reportMaxEvidenceItems: toPositiveInt(process.env.REPORT_MAX_EVIDENCE_ITEMS, 5),
  disputeMaxEvidenceItems: toPositiveInt(process.env.DISPUTE_MAX_EVIDENCE_ITEMS, 8),
  verificationMaxEvidenceItems: toPositiveInt(process.env.VERIFICATION_MAX_EVIDENCE_ITEMS, 5),
  evidenceSignedUrlTtlSeconds: toPositiveInt(process.env.EVIDENCE_SIGNED_URL_TTL_SECONDS, 300),
  evidenceUploadSessionTtlSeconds: toPositiveInt(process.env.EVIDENCE_UPLOAD_SESSION_TTL_SECONDS, 900),
  evidenceRetentionDays: toNonNegativeInt(process.env.EVIDENCE_RETENTION_DAYS, 0),
  staffInvitationTtlSeconds: toPositiveInt(process.env.STAFF_INVITATION_TTL_SECONDS, 7 * 24 * 60 * 60),
  sellerDeliveryDefaultMinutes: toPositiveInt(process.env.SELLER_DELIVERY_DEFAULT_MINUTES, 120),
  defaultBusinessPlanCode: (process.env.DEFAULT_BUSINESS_PLAN_CODE || 'FREE').trim().toUpperCase(),
  subscriptionGracePeriodDays: toNonNegativeInt(process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS, 7),
  subscriptionMaxRetryAttempts: toPositiveInt(process.env.SUBSCRIPTION_MAX_RETRY_ATTEMPTS, 3),
  subscriptionRetryIntervalMinutes: toPositiveInt(process.env.SUBSCRIPTION_RETRY_INTERVAL_MINUTES, 60),
  trialDurationDays: toNonNegativeInt(process.env.TRIAL_DURATION_DAYS, 0),
  subscriptionCurrency: (process.env.SUBSCRIPTION_CURRENCY || 'NGN').trim().toUpperCase(),
  subscriptionProMonthlyAmountMinor: toNonNegativeInt(process.env.SUBSCRIPTION_PRO_MONTHLY_AMOUNT_MINOR, 1_500_000),
  subscriptionProYearlyAmountMinor: toNonNegativeInt(process.env.SUBSCRIPTION_PRO_YEARLY_AMOUNT_MINOR, 15_000_000),
  subscriptionBusinessPlusMonthlyAmountMinor: toNonNegativeInt(process.env.SUBSCRIPTION_BUSINESS_PLUS_MONTHLY_AMOUNT_MINOR, 5_000_000),
  subscriptionBusinessPlusYearlyAmountMinor: toNonNegativeInt(process.env.SUBSCRIPTION_BUSINESS_PLUS_YEARLY_AMOUNT_MINOR, 50_000_000),
  promotionEventSecret: process.env.PROMOTION_EVENT_SECRET || process.env.JWT_ACCESS_SECRET || '',
  promotionImpressionCostMinor: toNonNegativeInt(process.env.PROMOTION_IMPRESSION_COST_MINOR, 100),
  promotionAttributionWindowDays: toPositiveInt(process.env.PROMOTION_ATTRIBUTION_WINDOW_DAYS, 7),
  analyticsBehavioralRetentionDays: toPositiveInt(process.env.ANALYTICS_BEHAVIORAL_RETENTION_DAYS, 395),
  analyticsSearchRetentionDays: toPositiveInt(process.env.ANALYTICS_SEARCH_RETENTION_DAYS, 90),
  analyticsBatchMaxEvents: toPositiveInt(process.env.ANALYTICS_BATCH_MAX_EVENTS, 50),
  analyticsOutboxBatchSize: toPositiveInt(process.env.ANALYTICS_OUTBOX_BATCH_SIZE, 100),
  privacyPolicyVersion: (process.env.PRIVACY_POLICY_VERSION || 'v1').trim().slice(0, 40),
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
});

function assertRuntimeConfig() {
  const required = [
    ['MONGODB_URI', env.mongodbUri],
    ['JWT_ACCESS_SECRET', env.jwtAccessSecret],
    ['JWT_REFRESH_SECRET', env.jwtRefreshSecret]
  ];

  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (env.nodeEnv === 'production') {
    const weakSecrets = [env.jwtAccessSecret, env.jwtRefreshSecret]
      .some((secret) => secret.length < 32);
    if (weakSecrets) {
      throw new Error('Production JWT secrets must be at least 32 characters long');
    }
    if (env.corsAllowedOrigins.length === 0) {
      throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
    }
    if (!env.paystackSecretKey || !env.paymentCallbackUrl) {
      throw new Error('PAYSTACK_SECRET_KEY and PAYMENT_CALLBACK_URL must be configured in production before accepting sales');
    }
    if (env.mediaProvider !== 'cloudinary' || !env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
      throw new Error('MEDIA_PROVIDER=cloudinary and Cloudinary credentials must be configured in production before accepting catalogue uploads');
    }
  }
}

module.exports = { env, assertRuntimeConfig };
