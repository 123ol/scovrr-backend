const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { env } = require('../../config/env');
const { AppError } = require('../../common/errors/AppError');
const { EvidenceAsset } = require('./evidence-asset.model');
const { EvidenceUploadSession } = require('./upload-session.model');
const { evidenceSnapshot } = require('./evidence-snapshot');
const { getMediaProvider } = require('../../integrations/media');
const { Report } = require('../reports/report.model');
const { Dispute } = require('../disputes/dispute.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { Conversation } = require('../conversations/conversation.model');
const { Business } = require('../businesses/business.model');
const { Delivery } = require('../deliveries/delivery.model');
const { Order } = require('../orders/order.model');
const reportService = require('../reports/report.service');
const { assertUserCanActById } = require('../users/user-status.service');

const REPORT_CONTEXT_TYPES = new Set(['business', 'product', 'service', 'review', 'user', 'message', 'conversation', 'order', 'booking']);
const SAFE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function assertObjectId(value, code = 'INVALID_EVIDENCE_SUBJECT') {
  if (!mongoose.isValidObjectId(value)) throw new AppError(400, code, 'The evidence subject is invalid');
}

function evidenceTypeForMime(mimeType) {
  if (SAFE_IMAGE_MIME_TYPES.has(mimeType)) return 'image';
  throw new AppError(400, 'UNSUPPORTED_EVIDENCE_TYPE', 'Only JPEG, PNG, and WEBP evidence is supported');
}

function publicId(userId, purpose) {
  return `scovrr/evidence/${purpose}/${userId}/${crypto.randomUUID()}`;
}

function retentionExpiry() {
  return env.evidenceRetentionDays > 0 ? new Date(Date.now() + env.evidenceRetentionDays * 86_400_000) : null;
}

function getEvidenceRetentionPolicy() {
  return {
    version: 'local-v1',
    automaticRetentionEnabled: env.evidenceRetentionDays > 0,
    retentionDays: env.evidenceRetentionDays || null,
    uploadSessionTtlSeconds: env.evidenceUploadSessionTtlSeconds,
    signedUrlTtlSeconds: env.evidenceSignedUrlTtlSeconds,
    lifecycle: ['Upload sessions expire automatically.', 'Attached evidence is retained until its configured lifecycle expires.', 'Provider deletion is attempted before an evidence record is marked revoked.'],
    notes: ['EVIDENCE_RETENTION_DAYS is disabled by default until legal and business retention policy is approved.', 'Existing records are not changed by enabling this configuration; only newly attached evidence receives a retention deadline.']
  };
}

async function assertDisputeAccess(userId, disputeId) {
  const dispute = await Dispute.findById(disputeId);
  if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
  if (dispute.customerId.toString() === userId.toString()) {
    if (!['open', 'awaiting_business_response', 'awaiting_customer_response', 'under_review'].includes(dispute.status)) throw new AppError(409, 'DISPUTE_CLOSED', 'Evidence cannot be added to a closed dispute');
    return { dispute, actorVisibility: 'parties' };
  }
  const membership = await BusinessMembership.findOne({ businessId: dispute.businessId, userId, status: 'active' });
  const allowed = membership && (membership.role === 'owner' || membership.permissions.includes('*') || membership.permissions.some((permission) => ['customers.manage', 'orders.manage', 'bookings.manage'].includes(permission)));
  if (!allowed) throw new AppError(403, 'DISPUTE_EVIDENCE_ACCESS_REQUIRED', 'You do not have permission to add evidence to this dispute');
  if (!['open', 'awaiting_business_response', 'awaiting_customer_response', 'under_review'].includes(dispute.status)) throw new AppError(409, 'DISPUTE_CLOSED', 'Evidence cannot be added to a closed dispute');
  return { dispute, actorVisibility: 'parties' };
}

async function createUploadSession(userId, input) {
  await assertUserCanActById(userId);
  const mimeType = input.mimeType.toLowerCase();
  const type = evidenceTypeForMime(mimeType);
  const maxBytes = env.evidenceImageMaxBytes;
  let contextSubjectType = null;
  let contextSubjectId = null;
  let disputeId = null;
  if (input.purpose === 'report') {
    if (!REPORT_CONTEXT_TYPES.has(input.subjectType)) throw new AppError(400, 'INVALID_REPORT_SUBJECT_TYPE', 'This subject type cannot receive report evidence');
    const result = await reportService.resolveSubject(userId, { subjectType: input.subjectType, subjectId: input.subjectId });
    contextSubjectType = input.subjectType;
    contextSubjectId = result.subject._id;
  } else if (input.purpose === 'dispute') {
    assertObjectId(input.disputeId);
    await assertDisputeAccess(userId, input.disputeId);
    disputeId = input.disputeId;
  } else if (input.purpose === 'verification') {
    assertObjectId(input.subjectId);
    const [business, membership] = await Promise.all([
      Business.findById(input.subjectId).select('_id ownerId status verification.status'),
      BusinessMembership.findOne({ businessId: input.subjectId, userId, status: 'active' }).select('role permissions')
    ]);
    if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
    if (!membership || (membership.role !== 'owner' && !membership.permissions.includes('*') && !membership.permissions.includes('business.manage'))) {
      throw new AppError(403, 'VERIFICATION_EVIDENCE_ACCESS_REQUIRED', 'Only an authorized business owner can add verification evidence');
    }
    if (!['draft', 'rejected'].includes(business.status) && business.verification?.status !== 'additional_information_required') {
      throw new AppError(409, 'VERIFICATION_EVIDENCE_NOT_AVAILABLE', 'Verification evidence cannot be changed while this business is awaiting review');
    }
    contextSubjectType = 'business';
    contextSubjectId = business._id;
  } else if (input.purpose === 'delivery') {
    assertObjectId(input.subjectId);
    const delivery = await Delivery.findById(input.subjectId).select('_id businessId status');
    if (!delivery) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
    const membership = await BusinessMembership.findOne({ businessId: delivery.businessId, userId, status: 'active' }).select('role permissions');
    const allowed = membership && (membership.role === 'owner' || membership.permissions.includes('*') || membership.permissions.some((permission) => ['orders.manage', 'orders.fulfill'].includes(permission)));
    if (!allowed) throw new AppError(403, 'DELIVERY_EVIDENCE_ACCESS_REQUIRED', 'Only an authorized seller can add delivery proof');
    if (['cancelled', 'completed', 'delivered', 'picked_up_by_customer'].includes(delivery.status)) throw new AppError(409, 'DELIVERY_PROOF_NOT_AVAILABLE', 'Proof cannot be added after delivery is complete');
    contextSubjectType = 'delivery';
    contextSubjectId = delivery._id;
  } else {
    assertObjectId(input.subjectId);
    const conversation = await Conversation.findOne({ _id: input.subjectId, participantIds: userId }).select('_id');
    if (!conversation) throw new AppError(403, 'CONVERSATION_ACCESS_REQUIRED', 'You do not have access to this conversation');
    contextSubjectType = 'conversation';
    contextSubjectId = conversation._id;
  }
  const provider = getMediaProvider();
  const expectedProviderAssetId = publicId(userId, input.purpose);
  const sessionData = await provider.createUploadSession({ publicId: expectedProviderAssetId, mimeType, maxBytes });
  const session = await EvidenceUploadSession.create({ userId, purpose: input.purpose, contextSubjectType, contextSubjectId, disputeId, provider: sessionData.provider, expectedProviderAssetId, mimeType, maxBytes, expiresAt: new Date(Date.now() + env.evidenceUploadSessionTtlSeconds * 1_000) });
  return { session, upload: sessionData, type };
}

async function completeUploadSession(userId, sessionId, input) {
  await assertUserCanActById(userId);
  assertObjectId(sessionId, 'INVALID_UPLOAD_SESSION');
  const session = await EvidenceUploadSession.findOne({ _id: sessionId, userId });
  if (!session) throw new AppError(404, 'UPLOAD_SESSION_NOT_FOUND', 'The evidence upload session was not found');
  if (session.status === 'uploaded' && session.evidenceId) {
    const existing = await EvidenceAsset.findById(session.evidenceId);
    if (existing) return existing;
    session.status = 'pending'; session.evidenceId = null; await session.save();
  }
  if (session.status !== 'pending' || session.expiresAt <= new Date()) {
    if (session.status === 'pending') { session.status = 'expired'; await session.save(); }
    throw new AppError(409, 'UPLOAD_SESSION_EXPIRED', 'The evidence upload session is no longer active');
  }
  const provider = getMediaProvider();
  let verified;
  try {
    verified = await provider.verifyUploadedAsset({ publicId: input.publicId, expectedPublicId: session.expectedProviderAssetId, mimeType: session.mimeType, maxBytes: session.maxBytes });
  } catch (error) {
    try { await provider.deleteAsset({ providerAssetId: session.expectedProviderAssetId }); } catch (_cleanupError) { /* provider cleanup is best effort; the session TTL still closes the reference */ }
    throw error;
  }
  const asset = await EvidenceAsset.create({ purpose: session.purpose, contextSubjectType: session.contextSubjectType, contextSubjectId: session.contextSubjectId, disputeId: session.disputeId, sessionId: session._id, uploadedBy: userId, provider: verified.provider, providerAssetId: verified.providerAssetId, storageKey: verified.storageKey, version: verified.version, type: evidenceTypeForMime(verified.mimeType), mimeType: verified.mimeType, format: verified.format, sizeBytes: verified.bytes, originalName: input.originalName || null, alt: input.alt || null, visibility: session.purpose === 'verification' ? 'admin_only' : 'parties', status: 'uploaded' });
  session.status = 'uploaded'; session.evidenceId = asset._id; await session.save();
  return asset;
}

async function attachEvidence({ userId, purpose, subject, evidenceAssetIds, visibility = 'parties' }) {
  await assertUserCanActById(userId);
  const ids = [...new Set((evidenceAssetIds || []).map(String))];
  const max = purpose === 'report'
    ? env.reportMaxEvidenceItems
    : purpose === 'dispute'
      ? env.disputeMaxEvidenceItems
      : purpose === 'verification'
        ? env.verificationMaxEvidenceItems
      : purpose === 'delivery'
        ? 3
        : env.reportMaxEvidenceItems;
  if (ids.length > max) throw new AppError(400, 'EVIDENCE_LIMIT_EXCEEDED', `A maximum of ${max} evidence item(s) is allowed`);
  if (!ids.length) return [];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new AppError(400, 'INVALID_EVIDENCE_ID', 'One or more evidence references are invalid');
  const assets = await EvidenceAsset.find({ _id: { $in: ids }, uploadedBy: userId, purpose, status: 'uploaded' });
  if (assets.length !== ids.length) throw new AppError(403, 'EVIDENCE_NOT_AUTHORIZED', 'One or more evidence items are not available to attach');
  for (const asset of assets) {
    const contextMatches = purpose === 'report'
      ? asset.contextSubjectType === subject.subjectType && asset.contextSubjectId?.toString() === subject.subjectId.toString()
      : purpose === 'verification'
        ? asset.contextSubjectType === 'business' && asset.contextSubjectId?.toString() === subject.subjectId.toString()
        : purpose === 'delivery'
          ? asset.contextSubjectType === 'delivery' && asset.contextSubjectId?.toString() === subject.subjectId.toString()
        : asset.disputeId?.toString() === subject.subjectId.toString();
    if (!contextMatches) throw new AppError(403, 'EVIDENCE_CONTEXT_MISMATCH', 'Evidence was prepared for a different case');
  }
  const claimedIds = [];
  try {
    for (const asset of assets) {
      const updated = await EvidenceAsset.findOneAndUpdate({ _id: asset._id, status: 'uploaded' }, { $set: { subjectType: purpose, subjectId: subject.id, visibility, status: 'attached', attachedAt: new Date(), retentionExpiresAt: retentionExpiry() } }, { new: true });
      if (!updated) throw new AppError(409, 'EVIDENCE_ALREADY_ATTACHED', 'Evidence was already attached to another case');
      claimedIds.push(asset._id);
    }
  } catch (error) {
    if (claimedIds.length) await EvidenceAsset.updateMany({ _id: { $in: claimedIds }, status: 'attached', subjectId: subject.id }, { $set: { status: 'uploaded', subjectType: null, subjectId: null, visibility: purpose === 'verification' ? 'admin_only' : 'parties', attachedAt: null, retentionExpiresAt: null } });
    throw error;
  }
  return assets.map((asset) => evidenceSnapshot({ ...asset.toObject(), _id: asset._id, visibility }));
}

async function assertAssetAccess(userId, assetId, options = {}) {
  assertObjectId(assetId, 'INVALID_EVIDENCE_ID');
  const asset = await EvidenceAsset.findById(assetId);
  if (!asset || ['hidden', 'revoked'].includes(asset.status)) throw new AppError(404, 'EVIDENCE_NOT_FOUND', 'Evidence not found');
  const isAdmin = Boolean(options.admin);
  if (isAdmin) {
    const required = asset.subjectType === 'report'
      ? 'reports.read'
      : asset.subjectType === 'verification'
        ? 'verification.read'
        : asset.subjectType === 'delivery'
          ? 'orders.read'
        : 'disputes.read';
    if (!options.permissions?.includes('*') && !options.permissions?.includes(required)) throw new AppError(403, 'EVIDENCE_ACCESS_DENIED', 'You do not have the permission to view this evidence');
    return asset;
  }
  if (asset.status === 'uploaded' && asset.uploadedBy.toString() === userId.toString()) return asset;
  if (asset.visibility === 'admin_only') throw new AppError(403, 'EVIDENCE_ACCESS_DENIED', 'This evidence is restricted');
  if (asset.purpose === 'message') {
    const conversationId = asset.contextSubjectId || asset.subjectId;
    const conversation = await Conversation.findOne({ _id: conversationId, participantIds: userId }).select('_id');
    if (conversation) return asset;
  }
  if (asset.subjectType === 'report') {
    const report = await Report.findById(asset.subjectId).select('reporterId');
    if (!report || report.reporterId.toString() !== userId.toString()) throw new AppError(403, 'EVIDENCE_ACCESS_DENIED', 'You do not have access to this evidence');
    return asset;
  }
  if (asset.subjectType === 'dispute') {
    const dispute = await Dispute.findById(asset.subjectId).select('customerId businessId');
    if (!dispute) throw new AppError(404, 'DISPUTE_NOT_FOUND', 'Dispute not found');
    if (dispute.customerId.toString() === userId.toString()) return asset;
    const membership = await BusinessMembership.findOne({ businessId: dispute.businessId, userId, status: 'active' });
    if (membership && (membership.role === 'owner' || membership.permissions.includes('*') || membership.permissions.some((permission) => ['customers.manage', 'orders.manage', 'bookings.manage'].includes(permission)))) return asset;
  }
  if (asset.subjectType === 'delivery') {
    const delivery = await Delivery.findById(asset.subjectId).select('businessId orderId');
    if (!delivery) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'Delivery not found');
    const order = await Order.findById(delivery.orderId).select('customerId');
    if (order?.customerId?.toString() === userId.toString()) return asset;
    const membership = await BusinessMembership.findOne({ businessId: delivery.businessId, userId, status: 'active' });
    if (membership && (membership.role === 'owner' || membership.permissions.includes('*') || membership.permissions.some((permission) => ['orders.read', 'orders.manage', 'orders.fulfill'].includes(permission)))) return asset;
  }
  if (asset.subjectType === 'verification') {
    throw new AppError(403, 'EVIDENCE_ACCESS_DENIED', 'Verification evidence is restricted to authorized administrators');
  }
  throw new AppError(403, 'EVIDENCE_ACCESS_DENIED', 'You do not have access to this evidence');
}

async function getAccessUrl(userId, assetId, options = {}) {
  const asset = await assertAssetAccess(userId, assetId, options);
  const provider = getMediaProvider();
  const access = provider.createAccessUrl(asset, env.evidenceSignedUrlTtlSeconds);
  return { asset, ...access };
}

async function cleanupExpiredUploads() {
  const sessions = await EvidenceUploadSession.find({ status: { $in: ['pending', 'uploaded'] }, expiresAt: { $lte: new Date() } }).limit(100);
  let cleaned = 0;
  for (const session of sessions) {
    if (session.evidenceId) {
      const asset = await EvidenceAsset.findById(session.evidenceId);
      if (asset && asset.status === 'uploaded') {
        try { await getMediaProvider().deleteAsset(asset); } catch (_error) { continue; }
        asset.status = 'revoked'; asset.hiddenAt = new Date(); await asset.save();
      }
    }
    session.status = 'expired'; await session.save(); cleaned += 1;
  }
  return { cleaned };
}

async function cleanupExpiredEvidence() {
  if (env.evidenceRetentionDays <= 0) return { cleaned: 0, skipped: true };
  const assets = await EvidenceAsset.find({ retentionExpiresAt: { $lte: new Date() }, status: { $in: ['uploaded', 'attached'] } }).sort({ retentionExpiresAt: 1 }).limit(100);
  let cleaned = 0;
  for (const asset of assets) {
    try {
      await getMediaProvider().deleteAsset(asset);
      asset.status = 'revoked';
      asset.hiddenAt = new Date();
      await asset.save();
      cleaned += 1;
    } catch (_error) {
      // Keep the asset retryable when provider deletion is temporarily unavailable.
    }
  }
  return { cleaned, skipped: false };
}

module.exports = { createUploadSession, completeUploadSession, attachEvidence, assertAssetAccess, getAccessUrl, cleanupExpiredUploads, cleanupExpiredEvidence, getEvidenceRetentionPolicy, assertDisputeAccess, retentionExpiry };
