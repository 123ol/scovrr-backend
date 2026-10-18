const express = require('express');
const { validate } = require('../../common/validation/validate');
const { optionalAuth } = require('../../middleware/auth');
const controller = require('./service.controller');
const { publicServiceListSchema, publicBusinessServiceListSchema, publicServiceBySlugSchema } = require('./service.validation');

const router = express.Router();
router.get('/services', validate(publicServiceListSchema), controller.publicList);
router.get('/businesses/:businessSlug/services', validate(publicBusinessServiceListSchema), (req, res, next) => { req.query.businessSlug = req.params.businessSlug; return controller.publicList(req, res, next); });
router.get('/services/:slug', optionalAuth, validate(publicServiceBySlugSchema), controller.publicBySlug);

module.exports = router;
