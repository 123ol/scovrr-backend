const { Report } = require('../reports/report.model');
const { Dispute } = require('../disputes/dispute.model');
const { ModerationCase } = require('../moderation/moderation-case.model');

const ACTIVE_REPORT_STATUSES = ['open', 'in_review', 'action_required'];
const ACTIVE_DISPUTE_STATUSES = ['open', 'awaiting_business_response', 'awaiting_customer_response', 'under_review'];
const ACTIVE_MODERATION_STATUSES = ['pending', 'under_review', 'action_required'];

function summarizeTrustSafety({ reports, disputes, moderation }) {
  const alerts = [];
  if (reports.critical > 0) alerts.push({ code: 'critical_reports', severity: 'critical', count: reports.critical });
  if (disputes.overdue > 0) alerts.push({ code: 'overdue_disputes', severity: 'high', count: disputes.overdue });
  if (disputes.recoveryRequired > 0) alerts.push({ code: 'financial_recovery', severity: 'high', count: disputes.recoveryRequired });
  if (moderation.unassigned > 0) alerts.push({ code: 'unassigned_moderation', severity: 'medium', count: moderation.unassigned });

  return {
    totals: {
      activeReports: reports.active,
      activeDisputes: disputes.active,
      activeModerationCases: moderation.active,
      alertCount: alerts.length
    },
    reports,
    disputes,
    moderation,
    alerts
  };
}

async function getTrustSafetyOverview() {
  const now = new Date();
  const [activeReports, criticalReports, unassignedReports, activeDisputes, overdueDisputes, unassignedDisputes, recoveryRequiredDisputes, activeModeration, urgentModeration, unassignedModeration] = await Promise.all([
    Report.countDocuments({ status: { $in: ACTIVE_REPORT_STATUSES } }),
    Report.countDocuments({ status: { $in: ACTIVE_REPORT_STATUSES }, priority: { $in: ['critical', 'high'] } }),
    Report.countDocuments({ status: { $in: ACTIVE_REPORT_STATUSES }, assignedAdminId: null }),
    Dispute.countDocuments({ status: { $in: ACTIVE_DISPUTE_STATUSES } }),
    Dispute.countDocuments({ status: { $in: ACTIVE_DISPUTE_STATUSES }, responseDeadline: { $lt: now, $ne: null } }),
    Dispute.countDocuments({ status: { $in: ACTIVE_DISPUTE_STATUSES }, assignedAdminId: null }),
    Dispute.countDocuments({ status: { $in: ACTIVE_DISPUTE_STATUSES }, financialState: 'recovery_required' }),
    ModerationCase.countDocuments({ status: { $in: ACTIVE_MODERATION_STATUSES } }),
    ModerationCase.countDocuments({ status: { $in: ACTIVE_MODERATION_STATUSES }, severity: { $in: ['critical', 'high'] } }),
    ModerationCase.countDocuments({ status: { $in: ACTIVE_MODERATION_STATUSES }, assignedModeratorId: null })
  ]);

  return {
    asOf: now,
    ...summarizeTrustSafety({
      reports: { active: activeReports, critical: criticalReports, unassigned: unassignedReports },
      disputes: { active: activeDisputes, overdue: overdueDisputes, unassigned: unassignedDisputes, recoveryRequired: recoveryRequiredDisputes },
      moderation: { active: activeModeration, urgent: urgentModeration, unassigned: unassignedModeration }
    })
  };
}

module.exports = { ACTIVE_REPORT_STATUSES, ACTIVE_DISPUTE_STATUSES, ACTIVE_MODERATION_STATUSES, summarizeTrustSafety, getTrustSafetyOverview };
