const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./content-post.service');
const { recordAudit } = require('../audit/audit.service');
const saveService = require('./content-post-save.service');

const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { post: (await service.createPost(req.business, req.body, req.auth.userId)).toOwnerJSON() } }));
const update = asyncHandler(async (req, res) => sendSuccess(res, { post: (await service.updatePost(req.business._id, req.params.postId, req.body, req.auth.userId)).toOwnerJSON() }));
const archive = asyncHandler(async (req, res) => sendSuccess(res, { post: (await service.archivePost(req.business._id, req.params.postId)).toOwnerJSON() }));
const submit = asyncHandler(async (req, res) => sendSuccess(res, { post: (await service.submitPost(req.business._id, req.params.postId)).toOwnerJSON() }));
const manageList = asyncHandler(async (req, res) => { const result = await service.listBusinessPosts(req.business._id, req.query); return sendSuccess(res, { ...result, posts: result.posts.map((post) => post.toOwnerJSON()) }); });
const manageMineList = asyncHandler(async (req, res) => { const result = await service.listUserBusinessPosts(req.auth.userId, req.query); return sendSuccess(res, { ...result, posts: result.posts.map((post) => post.toOwnerJSON()) }); });
const publicList = asyncHandler(async (req, res) => sendSuccess(res, await service.listPublicPosts(req.params.businessSlug, req.query, req.auth?.userId)));
const adminList = asyncHandler(async (req, res) => { const result = await service.listAdminPosts(req.query); return sendSuccess(res, { ...result, posts: result.posts.map((post) => ({ ...post.toOwnerJSON(), business: post.businessId && { id: post.businessId._id.toString(), name: post.businessId.name, slug: post.businessId.slug } })) }); });
const adminApprove = asyncHandler(async (req, res) => { const post = await service.reviewPost(req.params.postId, 'approve'); await recordAudit({ actorId: req.auth.userId, action: 'CONTENT_POST_MODERATED', targetType: 'content_post', targetId: post._id, after: post.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { post: post.toOwnerJSON() }); });
const adminReject = asyncHandler(async (req, res) => { const post = await service.reviewPost(req.params.postId, 'reject', req.body.reason); await recordAudit({ actorId: req.auth.userId, action: 'CONTENT_POST_MODERATED', targetType: 'content_post', targetId: post._id, reason: req.body.reason, after: post.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null }); return sendSuccess(res, { post: post.toOwnerJSON() }); });
const saved = asyncHandler(async (req, res) => sendSuccess(res, await service.listSavedPosts(req.auth.userId, req.query)));
const save = asyncHandler(async (req, res) => { await saveService.add(req.auth.userId, req.params.postId); return sendSuccess(res, { saved: true }); });
const unsave = asyncHandler(async (req, res) => { await saveService.remove(req.auth.userId, req.params.postId); return sendSuccess(res, { saved: false }); });

module.exports = { create, update, archive, submit, manageList, manageMineList, publicList, adminList, adminApprove, adminReject, saved, save, unsave };
