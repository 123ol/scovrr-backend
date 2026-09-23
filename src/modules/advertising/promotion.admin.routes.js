const express = require('express');
const { requireAuth, requireAdminPermission } = require('../../middleware/auth');
const { ADMIN_PERMISSIONS } = require('../admin/admin-permissions');
const { validate } = require('../../common/validation/validate');
const controller = require('./promotion.admin.controller');
const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const listSchema = z.object({ body: z.record(z.never()).default({}), params: z.record(z.never()).default({}), query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), status: z.string().optional(), targetType: z.string().optional(), businessId: objectId.optional() }) });
const idSchema = z.object({ body: z.record(z.never()).default({}), params: z.object({ campaignId: objectId }), query: z.record(z.never()).default({}) });
const moderateSchema = z.object({ body: z.object({ status: z.enum(['approved', 'rejected', 'removed', 'flagged']), reason: z.string().trim().min(5).max(1_000) }), params: z.object({ campaignId: objectId }), query: z.record(z.never()).default({}) });
const refundSchema = z.object({ body: z.object({ paymentId: objectId, amountMinor: z.number().int().positive().optional(), reason: z.string().trim().min(5).max(1_000), idempotencyKey: z.string().trim().min(12).max(160).optional() }), params: z.record(z.never()).default({}), query: z.record(z.never()).default({}) });

const router = express.Router();
router.get('/', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PROMOTIONS_READ), validate(listSchema), controller.list);
router.get('/:campaignId', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PROMOTIONS_READ), validate(idSchema), controller.get);
router.post('/:campaignId/pause', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PROMOTIONS_PAUSE), validate(idSchema), controller.pause);
router.post('/:campaignId/cancel', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PROMOTIONS_CANCEL), validate(idSchema), controller.cancel);
router.post('/:campaignId/moderate', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PROMOTIONS_MODERATE), validate(moderateSchema), controller.moderate);
router.post('/refund', requireAuth, requireAdminPermission(ADMIN_PERMISSIONS.PROMOTIONS_REFUND), validate(refundSchema), controller.refund);

module.exports = router;
