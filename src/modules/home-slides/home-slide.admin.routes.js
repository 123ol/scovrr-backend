const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./home-slide.controller');
const { createHomeSlideSchema, updateHomeSlideSchema, listHomeSlideSchema, homeSlideIdSchema } = require('./home-slide.validation');

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.HOME_SLIDES_READ), validate(listHomeSlideSchema), controller.adminList);
router.post('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.HOME_SLIDES_MANAGE), validate(createHomeSlideSchema), controller.create);
router.patch('/:slideId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.HOME_SLIDES_MANAGE), validate(updateHomeSlideSchema), controller.update);
router.delete('/:slideId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.HOME_SLIDES_MANAGE), validate(homeSlideIdSchema), controller.archive);

module.exports = router;
