const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./promotion.controller');
const validation = require('./promotion.validation');

const businessRouter = express.Router();
businessRouter.use(requireAuth);
businessRouter.get('/:businessId/advertising/promotions', requireBusinessPermission('promotions.read'), validate(validation.listSchema), controller.list);
businessRouter.post('/:businessId/advertising/promotions', requireBusinessPermission('promotions.create'), validate(validation.createSchema), controller.create);
businessRouter.get('/:businessId/advertising/promotions/:campaignId', requireBusinessPermission('promotions.read'), validate(validation.campaignIdSchema), controller.get);
businessRouter.patch('/:businessId/advertising/promotions/:campaignId', requireBusinessPermission('promotions.update'), validate(validation.updateSchema), controller.update);
businessRouter.post('/:businessId/advertising/promotions/:campaignId/fund', requireBusinessPermission('promotions.manage'), validate(validation.fundSchema), controller.fund);
businessRouter.post('/:businessId/advertising/promotions/:campaignId/pause', requireBusinessPermission('promotions.pause'), validate(validation.campaignIdSchema), controller.pause);
businessRouter.post('/:businessId/advertising/promotions/:campaignId/resume', requireBusinessPermission('promotions.update'), validate(validation.campaignIdSchema), controller.resume);
businessRouter.post('/:businessId/advertising/promotions/:campaignId/cancel', requireBusinessPermission('promotions.cancel'), validate(validation.campaignIdSchema), controller.cancel);
businessRouter.get('/:businessId/advertising/promotions/:campaignId/metrics', requireBusinessPermission('promotions.read'), validate(validation.metricSchema), controller.metrics);

module.exports = { businessRouter };
