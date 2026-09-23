const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { validate } = require('../../common/validation/validate');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const controller = require('./promotion.admin.controller');
const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ search: z.string().trim().max(120).optional(), status: z.enum(['draft', 'scheduled', 'active', 'paused', 'expired', 'archived']).optional(), businessId: objectId.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }) });
const disableSchema = z.object({ body: z.object({ reason: z.string().trim().min(5).max(1_000) }), params: z.object({ discountId: objectId }), query: z.record(z.never()).default({}) });
const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISCOUNTS_READ), validate(listSchema), controller.list);
router.post('/:discountId/disable', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.DISCOUNTS_MANAGE), validate(disableSchema), controller.disable);
module.exports = router;
