const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const service = require('./content-post-like.service');

const add = asyncHandler(async (req, res) => sendSuccess(res, { like: await service.addLike(req.params.postId, req.auth.userId) }));
const remove = asyncHandler(async (req, res) => sendSuccess(res, { like: await service.removeLike(req.params.postId, req.auth.userId) }));

module.exports = { add, remove };
