const express = require('express');
const { requireAuth } = require('../../middleware/auth');
const { requireBusinessPermission } = require('../../middleware/business-access');
const { validate } = require('../../common/validation/validate');
const controller = require('./portfolio.controller');
const { createPortfolioSchema, updatePortfolioSchema, portfolioListSchema } = require('./portfolio.validation');

const router = express.Router();
router.post('/:businessId/manage/portfolio', requireAuth, requireBusinessPermission('services.manage'), validate(createPortfolioSchema), controller.create);
router.get('/:businessId/manage/portfolio', requireAuth, requireBusinessPermission('services.manage'), validate(portfolioListSchema), controller.list);
router.patch('/:businessId/manage/portfolio/:portfolioId', requireAuth, requireBusinessPermission('services.manage'), validate(updatePortfolioSchema), controller.update);

module.exports = router;
