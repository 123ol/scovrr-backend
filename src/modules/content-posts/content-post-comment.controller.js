const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./content-post-comment.service');

const list = asyncHandler(async (req, res) => sendSuccess(res, await service.listComments(req.params.postId, req.query)));
const create = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { comment: (await service.createComment(req.params.postId, req.auth.userId, req.body.body, req.body.parentCommentId)).toPublicJSON() } }));
const manageList = asyncHandler(async (req, res) => sendSuccess(res, await service.listBusinessComments(req.business._id, req.params.postId, req.query)));
const businessCreate = asyncHandler(async (req, res) => res.status(201).json({ success: true, data: { comment: (await service.createBusinessComment(req.business._id, req.params.postId, req.auth.userId, req.body.body, req.body.parentCommentId)).toPublicJSON() } }));

module.exports = { list, create, manageList, businessCreate };
