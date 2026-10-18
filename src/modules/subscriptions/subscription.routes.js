const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./subscription.controller');
const { businessSubscriptionSchema, invoiceListSchema, cancelSchema, resumeSchema, changeSchema, checkoutSchema, recoverySchema } = require('./subscription.validation');

const businessRouter = express.Router();
const publicRouter = express.Router();
publicRouter.get('/plans', controller.plans);
businessRouter.post('/:businessId/subscription/checkout', requireAuth, requireBusinessPermission('subscription.manage'), validate(checkoutSchema), controller.checkout);
businessRouter.post('/:businessId/subscription/recovery', requireAuth, requireBusinessPermission('subscription.manage'), validate(recoverySchema), controller.recovery);
businessRouter.get('/:businessId/subscription', requireAuth, requireBusinessPermission('subscription.read'), validate(businessSubscriptionSchema), controller.get);
businessRouter.get('/:businessId/subscription/invoices', requireAuth, requireBusinessPermission('subscription.read'), validate(invoiceListSchema), controller.invoices);
businessRouter.post('/:businessId/subscription/cancel', requireAuth, requireBusinessPermission('subscription.manage'), validate(cancelSchema), controller.cancel);
businessRouter.post('/:businessId/subscription/resume', requireAuth, requireBusinessPermission('subscription.manage'), validate(resumeSchema), controller.resume);
businessRouter.post('/:businessId/subscription/change', requireAuth, requireBusinessPermission('subscription.manage'), validate(changeSchema), controller.scheduleChange);

module.exports = { businessRouter, publicRouter };
