const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./content-post.controller');
const commentController = require('./content-post-comment.controller');
const { createSchema, updateSchema, postIdSchema, listSchema, businessCommentCreateSchema, businessCommentListSchema } = require('./content-post.validation');

const router = express.Router();
router.post('/:businessId/content-posts', requireAuth, requireBusinessPermission('content.create'), validate(createSchema), controller.create);
router.get('/:businessId/content-posts', requireAuth, requireBusinessPermission('content.read'), validate(listSchema), controller.manageList);
router.get('/:businessId/content-posts/:postId/comments', requireAuth, requireBusinessPermission('content.read'), validate(businessCommentListSchema), commentController.manageList);
router.post('/:businessId/content-posts/:postId/comments', requireAuth, requireBusinessPermission('content.update'), validate(businessCommentCreateSchema), commentController.businessCreate);
router.patch('/:businessId/content-posts/:postId', requireAuth, requireBusinessPermission('content.update'), validate(updateSchema), controller.update);
router.delete('/:businessId/content-posts/:postId', requireAuth, requireBusinessPermission('content.update'), validate(postIdSchema), controller.archive);
router.post('/:businessId/content-posts/:postId/submit', requireAuth, requireBusinessPermission('content.update'), validate(postIdSchema), controller.submit);

module.exports = router;
