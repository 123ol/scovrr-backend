const mongoose = require('mongoose');
const { AppError } = require('../common/errors/AppError');
const { Business } = require('../modules/businesses/business.model');
const { BusinessMembership } = require('../modules/businesses/business-membership.model');
const { BusinessLocation } = require('../modules/businesses/business-location.model');
const { expandPermissions } = require('../modules/businesses/business-permissions');

function membershipHasPermission(membership, permission) {
  if (!membership) return false;
  if (membership.role === 'owner') return true;
  const permissions = expandPermissions(membership.permissions || []);
  return permissions.has('*') || (Array.isArray(permission) ? permission.some((item) => permissions.has(item)) : permissions.has(permission));
}

function assertLocationAccess(membership, locationId) {
  if (!locationId || membership.locationAccess?.mode !== 'selected') return true;
  return (membership.locationAccess?.locationIds || []).some((id) => id.toString() === locationId.toString());
}

async function resolveBusinessContext(req, { allowSuspended = false } = {}) {
  const businessId = req.params.businessId;
  if (!businessId || !mongoose.isValidObjectId(businessId)) throw new AppError(400, 'INVALID_BUSINESS_ID', 'The business identifier is invalid');
  const [business, membership] = await Promise.all([
    Business.findById(businessId),
    BusinessMembership.findOne({ userId: req.auth.userId, businessId, status: 'active' })
  ]);
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  if (!membership) throw new AppError(403, 'BUSINESS_ACCESS_REQUIRED', 'You do not belong to this business');
  if (!allowSuspended && business.status === 'suspended' && !['GET', 'HEAD'].includes(req.method)) throw new AppError(409, 'BUSINESS_SUSPENDED', 'This business is suspended and cannot accept operational changes');
  req.business = business;
  req.businessMembership = membership;
  return { business, membership };
}

function requireBusinessPermission(permission, options = {}) {
  return async (req, _res, next) => {
    try {
      await resolveBusinessContext(req, options);
      if (!membershipHasPermission(req.businessMembership, permission)) throw new AppError(403, 'BUSINESS_PERMISSION_REQUIRED', 'You do not have permission for this business action');
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireBusinessLocationAccess(locationParam = 'locationId') {
  return async (req, _res, next) => {
    try {
      const locationId = req.params[locationParam] || req.query[locationParam] || req.body?.[locationParam];
      if (!locationId || !mongoose.isValidObjectId(locationId)) throw new AppError(400, 'INVALID_LOCATION_ID', 'The location identifier is invalid');
      if (!assertLocationAccess(req.businessMembership, locationId)) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'You do not have access to this business location');
      const location = await BusinessLocation.findOne({ _id: locationId, businessId: req.business._id });
      if (!location) throw new AppError(404, 'LOCATION_NOT_FOUND', 'Business location not found');
      req.businessLocation = location;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function canAccessLocation(membership, locationId) {
  return assertLocationAccess(membership, locationId);
}

module.exports = { requireBusinessPermission, requireBusinessLocationAccess, resolveBusinessContext, membershipHasPermission, canAccessLocation };
