const { Business } = require('./business.model');
const { Report } = require('../reports/report.model');
const { Dispute } = require('../disputes/dispute.model');
const { PaymentRiskAssessment } = require('../payments/payment-risk-assessment.model');
const { Review } = require('../reviews/review.model');

function calculateRiskProfile({ report = {}, dispute = {}, payment = {}, repeat = {}, review = {} } = {}) {
  const score = Math.min(100,
    (report.highPriorityReports || 0) * 20
    + (report.reports || 0) * 5
    + (dispute.disputes || 0) * 15
    + (payment.paymentReviews || 0) * 5
    + (payment.highestPaymentRisk || 0) * 0.2
    + (repeat.repeatReporters || 0) * 10
    + (repeat.repeatDisputeCustomers || 0) * 15
    + (review.coordinatedReviewers || 0) * 8
    + (review.reviewBurstCount || 0) * 3
  );
  return {
    score: Number(score.toFixed(1)),
    riskBand: score >= 70 ? 'high' : score >= 30 ? 'medium' : 'low'
  };
}

async function listRiskSignals({ page = 1, limit = 25, businessId = null } = {}) {
  const filter = businessId ? { _id: businessId } : {};
  const skip = (page - 1) * limit;
  const [businesses, total] = await Promise.all([Business.find(filter).select('name slug status moderationStatus').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Business.countDocuments(filter)]);
  if (!businesses.length) return { businesses: [], total, page, limit, pages: Math.ceil(total / limit) };
  const ids = businesses.map((business) => business._id);
  const [reports, disputes, paymentRisks, repeatReporters, repeatDisputeCustomers, reviewSignals, reviewBursts] = await Promise.all([
    Report.aggregate([{ $match: { businessId: { $in: ids }, status: { $in: ['open', 'in_review', 'action_required'] } } }, { $group: { _id: '$businessId', reports: { $sum: 1 }, highPriorityReports: { $sum: { $cond: [{ $in: ['$priority', ['high', 'critical']] }, 1, 0] } } } }]),
    Dispute.aggregate([{ $match: { businessId: { $in: ids }, status: { $in: ['open', 'awaiting_business_response', 'under_review'] } } }, { $group: { _id: '$businessId', disputes: { $sum: 1 } } }]),
    PaymentRiskAssessment.aggregate([{ $match: { businessId: { $in: ids }, decision: 'review' } }, { $group: { _id: '$businessId', paymentReviews: { $sum: 1 }, highestPaymentRisk: { $max: '$score' } } }]),
    Report.aggregate([
      { $match: { businessId: { $in: ids }, status: { $in: ['open', 'in_review', 'action_required'] } } },
      { $group: { _id: { businessId: '$businessId', reporterId: '$reporterId' }, cases: { $sum: 1 } } },
      { $match: { cases: { $gte: 2 } } },
      { $group: { _id: '$_id.businessId', repeatReporters: { $sum: 1 }, repeatReportCases: { $sum: '$cases' } } }
    ]),
    Dispute.aggregate([
      { $match: { businessId: { $in: ids }, status: { $in: ['open', 'awaiting_business_response', 'under_review'] } } },
      { $group: { _id: { businessId: '$businessId', customerId: '$customerId' }, cases: { $sum: 1 } } },
      { $match: { cases: { $gte: 2 } } },
      { $group: { _id: '$_id.businessId', repeatDisputeCustomers: { $sum: 1 }, repeatDisputeCases: { $sum: '$cases' } } }
    ]),
    Review.aggregate([
      { $match: { businessId: { $in: ids }, status: { $in: ['approved', 'flagged'] }, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) } } },
      { $group: { _id: { businessId: '$businessId', reviewerId: '$reviewerId' }, cases: { $sum: 1 } } },
      { $match: { cases: { $gte: 3 } } },
      { $group: { _id: '$_id.businessId', coordinatedReviewers: { $sum: 1 }, coordinatedReviewCases: { $sum: '$cases' } } }
    ]),
    Review.aggregate([
      { $match: { businessId: { $in: ids }, status: { $in: ['approved', 'flagged'] }, createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60_000) } } },
      { $group: { _id: '$businessId', reviewBurstCount: { $sum: 1 } } },
      { $match: { reviewBurstCount: { $gte: 5 } } }
    ])
  ]);
  const byId = (rows) => new Map(rows.map((row) => [row._id.toString(), row]));
  const reportMap = byId(reports); const disputeMap = byId(disputes); const paymentMap = byId(paymentRisks); const repeatReportMap = byId(repeatReporters); const repeatDisputeMap = byId(repeatDisputeCustomers); const reviewMap = byId(reviewSignals); const reviewBurstMap = byId(reviewBursts);
  return {
    businesses: businesses.map((business) => {
      const businessKey = business._id.toString();
      const report = reportMap.get(businessKey) || {};
      const dispute = disputeMap.get(businessKey) || {};
      const payment = paymentMap.get(businessKey) || {};
      const repeatReports = repeatReportMap.get(businessKey) || {};
      const repeatDisputes = repeatDisputeMap.get(businessKey) || {};
      const review = { ...(reviewMap.get(businessKey) || {}), ...(reviewBurstMap.get(businessKey) || {}) };
      const profile = calculateRiskProfile({ report, dispute, payment, repeat: { ...repeatReports, ...repeatDisputes }, review });
      return {
        id: businessKey,
        name: business.name,
        slug: business.slug,
        status: business.status,
        moderationStatus: business.moderationStatus,
        score: profile.score,
        riskBand: profile.riskBand,
        signals: {
          openReports: report.reports || 0,
          highPriorityReports: report.highPriorityReports || 0,
          openDisputes: dispute.disputes || 0,
          paymentReviews: payment.paymentReviews || 0,
          highestPaymentRisk: payment.highestPaymentRisk || 0,
          repeatReporters: repeatReports.repeatReporters || 0,
          repeatReportCases: repeatReports.repeatReportCases || 0,
          repeatDisputeCustomers: repeatDisputes.repeatDisputeCustomers || 0,
          repeatDisputeCases: repeatDisputes.repeatDisputeCases || 0,
          coordinatedReviewers: review.coordinatedReviewers || 0,
          coordinatedReviewCases: review.coordinatedReviewCases || 0,
          reviewBurstCount: review.reviewBurstCount || 0
        }
      };
    }).sort((a, b) => b.score - a.score),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit)
  };
}

module.exports = { listRiskSignals, calculateRiskProfile };
