const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./email.service');

const webhook = asyncHandler(async (req, res) => {
  const result = await service.processResendWebhook(req.body, {
    id: req.get('svix-id') || req.get('resend-id'),
    timestamp: req.get('svix-timestamp') || req.get('resend-timestamp'),
    signature: req.get('svix-signature') || req.get('resend-signature')
  });
  return sendSuccess(res, result);
});

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listEmailDeliveries(req.query)));
const retry = asyncHandler(async (req, res) => sendSuccess(res, { delivery: await service.retryEmailDelivery(req.params.deliveryId) }));
const announcement = asyncHandler(async (req, res) => {
  const { User } = require('../users/user.model');
  const users = await User.find({ _id: { $in: req.body.userIds }, status: 'active' }).select('_id email firstName lastName').lean();
  const queued = [];
  for (const user of users) {
    queued.push(await service.queueEmail({ userId: user._id, toEmail: user.email, toName: `${user.firstName} ${user.lastName}`.trim(), templateKey: 'platform_announcement', data: { firstName: user.firstName, title: req.body.title, details: req.body.message, ctaLabel: req.body.ctaLabel, ctaUrl: req.body.ctaUrl }, idempotencyKey: `announcement:${req.body.title}:${user._id}`, metadata: { purpose: 'platform_announcement' } }));
  }
  return sendSuccess(res, { requested: req.body.userIds.length, matched: users.length, queued });
});

module.exports = { webhook, list, retry, announcement };
