const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./content-post.controller');
const commentController = require('./content-post-comment.controller');
const { publicListSchema, commentCreateSchema, commentListSchema } = require('./content-post.validation');

const router = express.Router();
router.get('/businesses/:businessSlug/content-posts', validate(publicListSchema), controller.publicList);
router.get('/content-posts/:postId/comments', validate(commentListSchema), commentController.list);
router.post('/content-posts/:postId/comments', requireAuth, validate(commentCreateSchema), commentController.create);

module.exports = router;
