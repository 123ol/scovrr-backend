const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./favorite.controller');
const { favoriteSchema, removeFavoriteSchema } = require('./favorite.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.list);
router.post('/', validate(favoriteSchema), controller.add);
router.delete('/:targetType/:targetId', validate(removeFavoriteSchema), controller.remove);

module.exports = router;
