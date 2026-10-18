const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const controller = require('./favorite.controller');
const { favoriteSchema, removeFavoriteSchema, collectionCreateSchema, collectionUpdateSchema, favoriteCollectionSchema } = require('./favorite.validation');

const router = express.Router();
router.use(requireAuth);
router.get('/', controller.list);
router.get('/collections', controller.collections);
router.post('/collections', validate(collectionCreateSchema), controller.createCollection);
router.patch('/collections/:collectionId', validate(collectionUpdateSchema), controller.updateCollection);
router.post('/', validate(favoriteSchema), controller.add);
router.patch('/:targetType/:targetId/collection', validate(favoriteCollectionSchema), controller.assignCollection);
router.delete('/:targetType/:targetId', validate(removeFavoriteSchema), controller.remove);

module.exports = router;
