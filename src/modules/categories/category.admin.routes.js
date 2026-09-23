const express = require('express');
const { validate } = require('../../common/validation/validate');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./category.controller');
const { createCategorySchema, updateCategorySchema, listCategorySchema } = require('./category.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.CATEGORIES_READ), validate(listCategorySchema), controller.listAdmin);
router.post('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.CATEGORIES_MANAGE), validate(createCategorySchema), controller.create);
router.patch('/:categoryId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.CATEGORIES_MANAGE), validate(updateCategorySchema), controller.update);

module.exports = router;
