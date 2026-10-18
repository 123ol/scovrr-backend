const express = require('express');
const { requireAuth, optionalAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./content-post.controller');
const commentController = require('./content-post-comment.controller');
const likeController = require('./content-post-like.controller');
const { publicListSchema, commentCreateSchema, commentListSchema, likeSchema, saveSchema, savedListSchema } = require('./content-post.validation');

const router = express.Router();
router.get('/businesses/:businessSlug/content-posts', optionalAuth, validate(publicListSchema), controller.publicList);
router.get('/content-posts/saved', requireAuth, validate(savedListSchema), controller.saved);
router.get('/content-posts/:postId/comments', validate(commentListSchema), commentController.list);
router.post('/content-posts/:postId/comments', requireAuth, validate(commentCreateSchema), commentController.create);
router.post('/content-posts/:postId/like', requireAuth, validate(likeSchema), likeController.add);
router.delete('/content-posts/:postId/like', requireAuth, validate(likeSchema), likeController.remove);
router.post('/content-posts/:postId/save', requireAuth, validate(saveSchema), controller.save);
router.delete('/content-posts/:postId/save', requireAuth, validate(saveSchema), controller.unsave);

module.exports = router;
