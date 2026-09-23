const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { env, assertRuntimeConfig } = require('./config/env');
const { connectDatabase } = require('./config/database');
const { AppError } = require('./common/errors/AppError');
const { errorHandler, notFoundHandler } = require('./common/errors/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const categoryRoutes = require('./modules/categories/category.routes');
const businessRoutes = require('./modules/businesses/business.routes');
const productBusinessRoutes = require('./modules/products/product.business.routes');
const productPublicRoutes = require('./modules/products/product.public.routes');
const addressRoutes = require('./modules/addresses/address.routes');
const favoriteRoutes = require('./modules/favorites/favorite.routes');
const cartRoutes = require('./modules/cart/cart.routes');
const orderRoutes = require('./modules/orders/order.routes');
const orderBusinessRoutes = require('./modules/orders/order.business.routes');
const discoveryRoutes = require('./modules/discovery/discovery.routes');
const serviceBusinessRoutes = require('./modules/services/service.business.routes');
const servicePublicRoutes = require('./modules/services/service.public.routes');
const portfolioBusinessRoutes = require('./modules/services/portfolio.business.routes');
const portfolioPublicRoutes = require('./modules/services/portfolio.public.routes');
const availabilityBusinessRoutes = require('./modules/availability/availability.business.routes');
const availabilityPublicRoutes = require('./modules/availability/availability.public.routes');
const bookingBusinessRoutes = require('./modules/bookings/booking.business.routes');
const bookingRoutes = require('./modules/bookings/booking.routes');
const paymentRoutes = require('./modules/payments/payment.routes');
const paymentAdminRoutes = require('./modules/payments/payment.admin.routes');
const reviewRoutes = require('./modules/reviews/review.routes');
const reviewBusinessRoutes = require('./modules/reviews/review.business.routes');
const followRoutes = require('./modules/follows/follow.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const conversationRoutes = require('./modules/conversations/conversation.routes');
const { businessRouter: payoutBusinessRoutes, adminRouter: payoutAdminRoutes } = require('./modules/payouts/payout.routes');
const reportRoutes = require('./modules/reports/report.routes');
const disputeRoutes = require('./modules/disputes/dispute.routes');
const disputeBusinessRoutes = require('./modules/disputes/dispute.business.routes');
const staffRoutes = require('./modules/staff/staff.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const promotionRoutes = require('./modules/promotions/promotion.routes');
const { businessRouter: subscriptionBusinessRoutes, publicRouter: subscriptionPublicRoutes } = require('./modules/subscriptions/subscription.routes');
const recommendationRoutes = require('./modules/analytics/recommendation.routes');
const reconciliationRoutes = require('./modules/reconciliation/reconciliation.routes');
const evidenceRoutes = require('./modules/evidence/evidence.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const deliveryRoutes = require('./modules/deliveries/delivery.routes');
const advertisingBusinessRoutes = require('./modules/advertising/promotion.routes');
const advertisingEventRoutes = require('./modules/advertising/promotion-event.routes');
const advertisingAdminRoutes = require('./modules/advertising/promotion.admin.routes');
const businessAnalyticsRoutes = require('./modules/analytics/business-analytics.routes');
const platformAnalyticsRoutes = require('./modules/analytics/platform-analytics.routes');
const contentPostBusinessRoutes = require('./modules/content-posts/content-post.business.routes');
const contentPostPublicRoutes = require('./modules/content-posts/content-post.public.routes');
const catalogueUploadRoutes = require('./modules/media/catalogue-upload.routes');
const homeSlideRoutes = require('./modules/home-slides/home-slide.routes');

const app = express();
let databasePromise = null;

async function ensureDatabaseConnection(_req, _res, next) {
  if (mongoose.connection.readyState === 1) return next();
  try {
    assertRuntimeConfig();
    if (!databasePromise) {
      databasePromise = connectDatabase().catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    await databasePromise;
    return next();
  } catch (error) {
    return next(error);
  }
}

function authorizeCron(req, _res, next) {
  if (!env.cronSecret || req.get('authorization') !== `Bearer ${env.cronSecret}`) {
    return next(new AppError(401, 'CRON_UNAUTHORIZED', 'Cron authorization is required'));
  }
  return next();
}

function isLocalDevelopmentOrigin(origin) {
  return env.nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || isLocalDevelopmentOrigin(origin) || env.corsAllowedOrigins.length === 0 || env.corsAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new AppError(403, 'CORS_ORIGIN_NOT_ALLOWED', 'This origin is not allowed'));
  }
}));
app.use('/api/v1/payments/webhooks/paystack', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false
}));

app.get('/health', ensureDatabaseConnection, (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  return res.status(connected ? 200 : 503).json({
    success: true,
    data: {
      status: connected ? 'ok' : 'degraded',
      service: 'scovrr-api',
      database: connected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/v1', (_req, res) => res.json({
  success: true,
  data: { name: 'SCOVRR API', version: 'v1' }
}));

app.get('/api/cron/jobs', authorizeCron, ensureDatabaseConnection, async (_req, res, next) => {
  try {
    const { processDueJobs, scheduleRecurringJobs } = require('./jobs/job-runner');
    await scheduleRecurringJobs({ autoPayouts: env.autoPayoutsEnabled, reconciliation: env.reconciliationEnabled });
    const processed = await processDueJobs(25);
    return res.json({ success: true, data: { processed } });
  } catch (error) {
    return next(error);
  }
});

// Vercel invokes this app per request, so establish MongoDB connectivity before API routes.
// The traditional server is already connected before it starts listening, making this a no-op there.
app.use(ensureDatabaseConnection);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/businesses', businessRoutes);
app.use('/api/v1', productPublicRoutes);
app.use('/api/v1/businesses', productBusinessRoutes);
app.use('/api/v1/businesses', inventoryRoutes);
app.use('/api/v1', servicePublicRoutes);
app.use('/api/v1', contentPostPublicRoutes);
app.use('/api/v1/home-slides', homeSlideRoutes);
app.use('/api/v1', portfolioPublicRoutes);
app.use('/api/v1/businesses', serviceBusinessRoutes);
app.use('/api/v1/businesses', contentPostBusinessRoutes);
app.use('/api/v1/businesses', catalogueUploadRoutes);
app.use('/api/v1/businesses', portfolioBusinessRoutes);
app.use('/api/v1/businesses', availabilityBusinessRoutes);
app.use('/api/v1/availability', availabilityPublicRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/favorites', favoriteRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1', deliveryRoutes);
app.use('/api/v1/businesses', orderBusinessRoutes);
app.use('/api/v1/bookings', bookingRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1', reviewRoutes);
app.use('/api/v1/businesses', reviewBusinessRoutes);
app.use('/api/v1/follows', followRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/disputes', disputeRoutes);
app.use('/api/v1/uploads/evidence', evidenceRoutes);
app.use('/api/v1/analytics/events', analyticsRoutes);
app.use('/api/v1/recommendations', recommendationRoutes);
app.use('/api/v1/businesses', bookingBusinessRoutes);
app.use('/api/v1/businesses', disputeBusinessRoutes);
app.use('/api/v1/businesses', staffRoutes);
app.use('/api/v1/businesses', promotionRoutes);
app.use('/api/v1/businesses', advertisingBusinessRoutes.businessRouter);
app.use('/api/v1/businesses', businessAnalyticsRoutes);
app.use('/api/v1/promotions/events', advertisingEventRoutes);
app.use('/api/v1/subscription', subscriptionPublicRoutes);
app.use('/api/v1/businesses', subscriptionBusinessRoutes);
app.use('/api/v1/businesses', payoutBusinessRoutes);
app.use('/api/v1/discover', discoveryRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/admin/payments', paymentAdminRoutes);
app.use('/api/v1/admin/payouts', payoutAdminRoutes);
app.use('/api/v1/admin/reconciliation', reconciliationRoutes);
app.use('/api/v1/admin/promotions', advertisingAdminRoutes);
app.use('/api/v1/admin/analytics', platformAnalyticsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// Export the Express application directly for Vercel's zero-config Express detection.
// Keep the named property for the traditional Socket.IO server entrypoint.
module.exports = app;
module.exports.app = app;
