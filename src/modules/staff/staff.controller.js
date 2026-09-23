const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./staff.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listMembers(req.business._id, req.query)));
const invitations = asyncHandler(async (req, res) => sendSuccess(res, await service.listInvitations(req.business._id, req.query)));
const add = asyncHandler(async (req, res) => {
  const result = await service.addMember(req.business._id, req.auth.userId, req.body);
  return res.status(201).json({ success: true, data: { member: result.member, invitation: result.invitation.toSafeJSON(true, result.rawToken), delivery: { channel: 'manual_handoff', requiresEmailProvider: result.requiresEmailProvider, message: 'No email provider is configured; deliver the invitation token through a trusted channel.' } } });
});
const update = asyncHandler(async (req, res) => sendSuccess(res, { member: await service.updateMember(req.business._id, req.params.membershipId, req.auth.userId, req.body) }));
const revokeInvitation = asyncHandler(async (req, res) => sendSuccess(res, { invitation: (await service.revokeInvitation(req.business._id, req.params.invitationId, req.auth.userId)).toSafeJSON() }));
const acceptInvitation = asyncHandler(async (req, res) => sendSuccess(res, { membership: service.memberJSON(await service.acceptInvitation(req.auth.userId, req.params.token)) }));

module.exports = { list, invitations, add, update, revokeInvitation, acceptInvitation };
