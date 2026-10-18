const { Payment } = require('./payment.model');
const { PaymentRiskAssessment } = require('./payment-risk-assessment.model');

const REVIEW_THRESHOLD = 60;
const HIGH_AMOUNT_MINOR = 500_000;

function scoreRiskSignals({ payment, customer, recentFailedPayments = 0 }) {
  const flags = [];
  let score = 0;
  if (payment.amountMinor >= HIGH_AMOUNT_MINOR) { score += 25; flags.push('high_amount'); }
  if (recentFailedPayments >= 3) { score += 45; flags.push('repeated_payment_failures'); }
  if (customer?.createdAt && Date.now() - new Date(customer.createdAt).getTime() < 24 * 60 * 60 * 1_000) { score += 15; flags.push('new_account'); }
  if (payment.type === 'promotion') { score += 10; flags.push('promotion_funding'); }
  return { score: Math.min(100, score), flags, decision: score >= REVIEW_THRESHOLD ? 'review' : 'allow' };
}

async function assessPayment(payment) {
  const { User } = require('../users/user.model');
  const [customer, recentFailedPayments] = await Promise.all([
    payment.customerId ? User.findById(payment.customerId).select('createdAt') : null,
    Payment.countDocuments({ customerId: payment.customerId, status: 'failed', createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) } })
  ]);
  const result = scoreRiskSignals({ payment, customer, recentFailedPayments });
  return PaymentRiskAssessment.findOneAndUpdate(
    { paymentId: payment._id },
    { $setOnInsert: { paymentId: payment._id, customerId: payment.customerId, businessId: payment.businessId || null, type: payment.type, ...result, source: 'deterministic-v1', assessedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function listAssessments(query) {
  const filter = { ...(query.decision ? { decision: query.decision } : {}) };
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    PaymentRiskAssessment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
    PaymentRiskAssessment.countDocuments(filter)
  ]);
  return { assessments: items.map((item) => item.toSafeJSON()), total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit) };
}

module.exports = { REVIEW_THRESHOLD, HIGH_AMOUNT_MINOR, scoreRiskSignals, assessPayment, listAssessments };
