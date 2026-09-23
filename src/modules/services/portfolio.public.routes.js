const express = require('express');
const { validate } = require('../../common/validation/validate');
const { Business } = require('../businesses/business.model');
const { AppError } = require('../../common/errors/AppError');
const controller = require('./portfolio.controller');
const { publicPortfolioSchema } = require('./portfolio.validation');

const router = express.Router();
router.get('/businesses/:businessSlug/portfolio', validate(publicPortfolioSchema), async (req, res, next) => {
  try {
    const business = await Business.findOne({ slug: req.params.businessSlug, status: 'active', moderationStatus: 'approved' });
    if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
    req.business = business;
    return controller.publicList(req, res, next);
  } catch (error) { return next(error); }
});

module.exports = router;
