const { AppError } = require('../../common/errors/AppError');
const { env } = require('../../config/env');
const { createOpaqueToken, hashToken } = require('../../common/security/tokens');
const { User } = require('../users/user.model');
const { BusinessMembership, permissionsForRole } = require('../businesses/business-membership.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { BusinessInvitation } = require('./business-invitation.model');
const { BusinessActivity } = require('../businesses/business-activity.model');
const { Business } = require('../businesses/business.model');
const { Booking } = require('../bookings/booking.model');
const entitlementService = require('../subscriptions/entitlement.service');

function normalizeEmail(email) { return email.trim().toLowerCase(); }

function memberJSON(membership) {
  const user = membership.userId?._id ? membership.userId : null;
  return { ...membership.toJSONSafe(), user: user ? { id: user._id.toString(), firstName: user.firstName, lastName: user.lastName, email: user.email, status: user.status } : null };
}

async function recordActivity({ businessId, actorId, action, targetType, targetId, metadata = {}, reason }) {
  return BusinessActivity.create({ businessId, actorId, action, targetType, targetId, metadata, reason });
}

async function validateLocationAccess(businessId, locationAccess = {}) {
  const mode = locationAccess.mode || 'all';
  const locationIds = locationAccess.locationIds || [];
  if (mode === 'selected') {
    if (!locationIds.length) throw new AppError(400, 'LOCATION_ACCESS_REQUIRED', 'Select at least one business location');
    const count = await BusinessLocation.countDocuments({ businessId, _id: { $in: locationIds }, active: true });
    if (count !== new Set(locationIds.map(String)).size) throw new AppError(400, 'INVALID_LOCATION_ACCESS', 'Every selected location must belong to this active business');
  }
  return { mode, locationIds: [...new Set(locationIds.map(String))] };
}

async function listMembers(businessId, { page = 1, limit = 50 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { businessId };
  const [members, total] = await Promise.all([
    BusinessMembership.find(filter).sort({ role: 1, createdAt: 1 }).skip(skip).limit(limit).populate('userId', 'firstName lastName email status'),
    BusinessMembership.countDocuments(filter)
  ]);
  return { members: members.map(memberJSON), total, page, limit, pages: Math.ceil(total / limit) };
}

async function listInvitations(businessId, { page = 1, limit = 50, status } = {}) {
  const filter = { businessId, ...(status ? { status } : {}) };
  const skip = (page - 1) * limit;
  const [invitations, total] = await Promise.all([
    BusinessInvitation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('invitedBy', 'firstName lastName email'),
    BusinessInvitation.countDocuments(filter)
  ]);
  return { invitations: invitations.map((item) => item.toSafeJSON()), total, page, limit, pages: Math.ceil(total / limit) };
}

async function addMember(businessId, actorId, input) {
  const email = normalizeEmail(input.email);
  const business = await Business.findById(businessId).select('status');
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  await entitlementService.assertWithinLimit(businessId, 'business.staff.max', 1);
  const user = await User.findOne({ email, status: { $in: ['active', 'pending_verification'] } }).select('_id firstName lastName email status');
  const existing = user ? await BusinessMembership.findOne({ businessId, userId: user._id }) : null;
  if (existing?.status === 'active') throw new AppError(409, 'STAFF_MEMBERSHIP_EXISTS', 'This user already belongs to the business');
  const locationAccess = await validateLocationAccess(businessId, input.locationAccess);
  const activeInvitation = await BusinessInvitation.findOne({ businessId, recipientEmail: email, status: 'pending', expiresAt: { $gt: new Date() } });
  if (activeInvitation) throw new AppError(409, 'STAFF_INVITATION_EXISTS', 'There is already a pending invitation for this email');
  const rawToken = createOpaqueToken();
  const invitation = await BusinessInvitation.create({
    businessId, recipientEmail: email, recipientUserId: user?._id || null, role: input.role,
    permissions: permissionsForRole(input.role), locationAccess, tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + env.staffInvitationTtlSeconds * 1_000), invitedBy: actorId
  });
  let member = null;
  if (existing) {
    existing.role = input.role;
    existing.permissions = permissionsForRole(input.role);
    existing.locationAccess = locationAccess;
    existing.status = 'invited';
    existing.invitedBy = actorId;
    existing.revokedAt = null;
    existing.joinedAt = null;
    await existing.save();
    await existing.populate('userId', 'firstName lastName email status');
    member = memberJSON(existing);
  }
  await recordActivity({ businessId, actorId, action: 'STAFF_INVITED', targetType: 'business_invitation', targetId: invitation._id, metadata: { recipientEmail: email, role: input.role, locationAccess } });
  return { invitation, member, rawToken, requiresEmailProvider: true };
}

async function acceptInvitation(userId, rawToken) {
  const tokenHash = hashToken(rawToken);
  const invitation = await BusinessInvitation.findOne({ tokenHash, status: 'pending' }).select('+tokenHash');
  if (!invitation) throw new AppError(404, 'STAFF_INVITATION_NOT_FOUND', 'This invitation is invalid, expired, or no longer available');
  if (invitation.expiresAt <= new Date()) {
    invitation.status = 'expired';
    await invitation.save();
    throw new AppError(410, 'STAFF_INVITATION_EXPIRED', 'This staff invitation has expired');
  }
  const user = await User.findById(userId).select('email status');
  if (!user || user.status !== 'active') throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'Only an active SCOVRR account can accept this invitation');
  if ((invitation.recipientUserId && invitation.recipientUserId.toString() !== userId.toString()) || invitation.recipientEmail !== user.email.toLowerCase()) throw new AppError(403, 'STAFF_INVITATION_RECIPIENT_MISMATCH', 'This invitation belongs to a different account');
  const business = await Business.findById(invitation.businessId).select('status');
  if (!business || business.status === 'closed') throw new AppError(409, 'BUSINESS_UNAVAILABLE', 'This business is no longer accepting staff invitations');
  const membership = await BusinessMembership.findOneAndUpdate(
    { businessId: invitation.businessId, userId },
    { $set: { role: invitation.role, permissions: invitation.permissions, locationAccess: invitation.locationAccess, status: 'active', invitedBy: invitation.invitedBy, joinedAt: new Date(), revokedAt: null } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  invitation.status = 'accepted'; invitation.acceptedBy = userId; invitation.acceptedAt = new Date();
  await invitation.save();
  await recordActivity({ businessId: invitation.businessId, actorId: userId, action: 'STAFF_JOINED', targetType: 'business_membership', targetId: membership._id, metadata: { invitationId: invitation._id.toString(), role: membership.role } });
  return membership;
}

async function revokeInvitation(businessId, invitationId, actorId) {
  const invitation = await BusinessInvitation.findOneAndUpdate({ _id: invitationId, businessId, status: 'pending' }, { $set: { status: 'revoked', revokedBy: actorId, revokedAt: new Date() } }, { new: true });
  if (!invitation) throw new AppError(404, 'STAFF_INVITATION_NOT_FOUND', 'Pending invitation not found');
  if (invitation.recipientUserId) await BusinessMembership.updateOne({ businessId, userId: invitation.recipientUserId, status: 'invited' }, { $set: { status: 'revoked', revokedAt: new Date() } });
  await recordActivity({ businessId, actorId, action: 'STAFF_INVITATION_REVOKED', targetType: 'business_invitation', targetId: invitation._id });
  return invitation;
}

async function updateMember(businessId, membershipId, actorId, input) {
  const membership = await BusinessMembership.findOne({ _id: membershipId, businessId }).populate('userId', 'firstName lastName email status');
  if (!membership) throw new AppError(404, 'STAFF_MEMBERSHIP_NOT_FOUND', 'Business membership not found');
  if (membership.role === 'owner') throw new AppError(409, 'OWNER_MEMBERSHIP_PROTECTED', 'The owner membership cannot be changed here');
  if (input.role === 'owner') throw new AppError(403, 'OWNER_ROLE_PROTECTED', 'Ownership transfer requires a dedicated safeguarded workflow');
  if (input.status === 'revoked' && membership.status !== 'revoked') {
    const futureBooking = await Booking.exists({ businessId, staffUserId: membership.userId._id, status: { $in: ['pending_payment', 'requested', 'confirmed', 'upcoming', 'checked_in'] }, startAt: { $gt: new Date() } });
    if (futureBooking) throw new AppError(409, 'STAFF_HAS_FUTURE_BOOKINGS', 'Reassign future bookings before removing this staff member');
  }
  if (input.role !== undefined) { membership.role = input.role; membership.permissions = permissionsForRole(input.role); }
  if (input.locationAccess !== undefined) membership.locationAccess = await validateLocationAccess(businessId, input.locationAccess);
  if (input.status !== undefined) { membership.status = input.status; membership.joinedAt = input.status === 'active' ? (membership.joinedAt || new Date()) : membership.joinedAt; membership.revokedAt = ['revoked', 'suspended'].includes(input.status) ? new Date() : null; }
  await membership.save();
  await recordActivity({ businessId, actorId, action: input.status === 'suspended' ? 'STAFF_SUSPENDED' : input.status === 'active' ? 'STAFF_REACTIVATED' : input.status === 'revoked' ? 'STAFF_REMOVED' : input.role ? 'STAFF_ROLE_CHANGED' : 'STAFF_LOCATION_ACCESS_CHANGED', targetType: 'business_membership', targetId: membership._id, metadata: { role: membership.role, status: membership.status, locationAccess: membership.locationAccess } });
  return memberJSON(membership);
}

module.exports = { listMembers, listInvitations, addMember, acceptInvitation, revokeInvitation, updateMember, memberJSON, validateLocationAccess, recordActivity };
