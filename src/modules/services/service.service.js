const { AppError } = require('../../common/errors/AppError');
const { slugify } = require('../../common/slug');
const { Service } = require('./service.model');
const { Business } = require('../businesses/business.model');
const { BusinessMembership } = require('../businesses/business-membership.model');
const { Category } = require('../categories/category.model');
const { BusinessLocation } = require('../businesses/business-location.model');
const { ServicePriceHistory } = require('./service-price-history.model');
const entitlementService = require('../subscriptions/entitlement.service');
const { sanitizeCatalogueMedia, assertPublishableCatalogueMedia } = require('../media/catalogue-media.service');

async function uniqueServiceSlug(business, name) {
  const base = `${slugify(business.slug)}-${slugify(name)}`.slice(0, 170);
  let candidate = base;
  let suffix = 2;
  while (await Service.exists({ slug: candidate })) { candidate = `${base}-${suffix}`; suffix += 1; }
  return candidate;
}

async function validateCategory(categoryId, business) {
  if (!categoryId) return null;
  const category = await Category.findOne({ _id: categoryId, enabled: true }).select('type');
  if (!category) throw new AppError(400, 'INVALID_SERVICE_CATEGORY', 'The selected category is unavailable');
  if (category.type !== 'both' && category.type !== 'service') throw new AppError(400, 'CATEGORY_CAPABILITY_MISMATCH', 'The selected category is not a service category');
  if (!business.capabilities.includes('services')) throw new AppError(400, 'SERVICES_CAPABILITY_REQUIRED', 'Enable the services capability before creating services');
  return category._id;
}

async function validateStaff(businessId, staffUserIds) {
  if (!staffUserIds) return undefined;
  if (!staffUserIds.length) return [];
  const memberships = await BusinessMembership.find({ businessId, userId: { $in: staffUserIds }, status: 'active', role: { $in: ['owner', 'administrator', 'manager', 'booking_manager', 'booking_staff', 'professional'] } }).select('userId locationAccess');
  if (memberships.length !== new Set(staffUserIds).size) throw new AppError(400, 'INVALID_SERVICE_STAFF', 'Every assigned staff member must have an active membership in this business');
  return memberships.map((membership) => membership.userId);
}

async function validateLocations(businessId, locationIds = []) {
  if (!locationIds.length) return [];
  const locations = await BusinessLocation.find({ businessId, _id: { $in: locationIds }, active: true }).select('_id');
  if (locations.length !== new Set(locationIds.map(String)).size) throw new AppError(400, 'INVALID_SERVICE_LOCATIONS', 'Every service location must belong to this active business');
  return locations.map((location) => location._id);
}

async function validateStaffAssignments(businessId, assignments = []) {
  if (!assignments.length) return [];
  const staffUserIds = assignments.map((assignment) => assignment.staffUserId);
  const validStaff = await validateStaff(businessId, staffUserIds);
  const validLocations = new Set((await BusinessLocation.find({ businessId, _id: { $in: assignments.flatMap((item) => item.locationIds || []) }, active: true }).select('_id')).map((location) => location._id.toString()));
  for (const assignment of assignments) {
    const membership = await BusinessMembership.findOne({ businessId, userId: assignment.staffUserId, status: 'active' }).select('locationAccess');
    if (!validStaff.some((id) => id.toString() === assignment.staffUserId.toString())) throw new AppError(400, 'INVALID_SERVICE_STAFF', 'Every assigned professional must have an active service membership');
    if (membership?.locationAccess?.mode === 'selected' && (assignment.locationIds || []).some((locationId) => !membership.locationAccess.locationIds.some((allowedId) => allowedId.toString() === locationId.toString()))) throw new AppError(400, 'INVALID_SERVICE_STAFF_LOCATIONS', 'A professional cannot be assigned outside their branch access');
    if ((assignment.locationIds || []).some((locationId) => !validLocations.has(locationId.toString()))) throw new AppError(400, 'INVALID_SERVICE_STAFF_LOCATIONS', 'Every staff service location must belong to this business');
  }
  return assignments.map((assignment) => ({ staffUserId: assignment.staffUserId, locationIds: assignment.locationIds || [] }));
}

function normalizeVariants(variants = [], basePriceMinor, existingVariants = []) {
  const existingById = new Map(existingVariants.map((variant) => [variant.variantId.toString(), variant]));
  const names = new Set();
  return variants.map((variant) => {
    if (names.has(variant.name.toLowerCase())) throw new AppError(400, 'DUPLICATE_SERVICE_VARIANT', 'Service variant names must be unique');
    names.add(variant.name.toLowerCase());
    const existing = variant.variantId ? existingById.get(variant.variantId.toString()) : null;
    return { ...variant, variantId: existing?.variantId || variant.variantId, priceMinor: variant.priceMinor || basePriceMinor, durationMinutes: variant.durationMinutes, bufferBeforeMinutes: variant.bufferBeforeMinutes ?? 0, bufferAfterMinutes: variant.bufferAfterMinutes ?? 0 };
  });
}

async function createService(business, input, actorId = null) {
  await entitlementService.assertFeature(business._id, 'services.enabled');
  await entitlementService.assertWithinLimit(business._id, 'commerce.services.max', 1);
  if (!business.capabilities.includes('services')) throw new AppError(400, 'SERVICES_CAPABILITY_REQUIRED', 'This business cannot publish services until services capability is enabled');
  const categoryId = await validateCategory(input.categoryId, business);
  const media = await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: input.media, field: 'Service media' });
  const staffUserIds = await validateStaff(business._id, input.staffUserIds);
  const locationIds = await validateLocations(business._id, input.locationIds);
  const staffAssignments = await validateStaffAssignments(business._id, input.staffAssignments);
  const resolvedStaffUserIds = [...new Map([...(staffUserIds || []), ...staffAssignments.map((assignment) => assignment.staffUserId)].map((id) => [id.toString(), id])).values()];
  const variants = await Promise.all((input.variants || []).map(async (variant) => ({ ...variant, media: await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: variant.media, field: 'Service variant media' }) })));
  const service = await Service.create({ ...input, media, businessId: business._id, categoryId, slug: await uniqueServiceSlug(business, input.name), locationIds, staffUserIds: resolvedStaffUserIds, staffAssignments, variants: normalizeVariants(variants, input.basePriceMinor), status: 'draft', moderationStatus: 'pending' });
  await ServicePriceHistory.create({ serviceId: service._id, businessId: business._id, actorId, basePriceMinor: service.basePriceMinor, currency: service.currency, variants: service.variants.map((variant) => ({ variantId: variant.variantId, name: variant.name, priceMinor: variant.priceMinor, currency: service.currency })), reason: 'service_price_initial' });
  return service;
}

async function updateService(business, serviceId, input, actorId = null) {
  const service = await Service.findOne({ _id: serviceId, businessId: business._id });
  if (!service) throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found');
  if (input.categoryId !== undefined) service.categoryId = await validateCategory(input.categoryId, business);
  const priceChanged = input.basePriceMinor !== undefined || input.currency !== undefined || input.variants !== undefined;
  for (const field of ['name', 'description', 'shortDescription', 'basePriceMinor', 'currency', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'locationTypes', 'paymentRule', 'depositAmountMinor', 'cancellationWindowHours', 'minNoticeMinutes', 'maxAdvanceDays']) if (input[field] !== undefined) service[field] = input[field];
  if (input.media !== undefined) service.media = await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: input.media, field: 'Service media' });
  if (input.staffUserIds !== undefined) service.staffUserIds = await validateStaff(business._id, input.staffUserIds);
  if (input.locationIds !== undefined) service.locationIds = await validateLocations(business._id, input.locationIds);
  if (input.staffAssignments !== undefined) {
    service.staffAssignments = await validateStaffAssignments(business._id, input.staffAssignments);
    service.staffUserIds = [...new Map([...(service.staffUserIds || []), ...service.staffAssignments.map((assignment) => assignment.staffUserId)].map((id) => [id.toString(), id])).values()];
  }
  if (input.variants !== undefined) {
    const variants = await Promise.all(input.variants.map(async (variant) => ({ ...variant, media: await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: variant.media, field: 'Service variant media' }) })));
    service.variants = normalizeVariants(variants, input.basePriceMinor || service.basePriceMinor, service.variants);
  }
  if (service.paymentRule === 'deposit' && (!service.depositAmountMinor || service.depositAmountMinor >= service.basePriceMinor)) throw new AppError(400, 'INVALID_SERVICE_DEPOSIT', 'Deposit must be greater than zero and less than the service price');
  if (['active', 'rejected'].includes(service.status)) { service.status = 'draft'; service.moderationStatus = 'pending'; service.publishedAt = null; }
  await service.save();
  if (priceChanged) await ServicePriceHistory.create({ serviceId: service._id, businessId: business._id, actorId, basePriceMinor: service.basePriceMinor, currency: service.currency, variants: service.variants.map((variant) => ({ variantId: variant.variantId, name: variant.name, priceMinor: variant.priceMinor, currency: service.currency })) });
  return service;
}

async function submitService(businessId, serviceId) {
  const service = await Service.findOne({ _id: serviceId, businessId });
  if (!service) throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found');
  if (!['draft', 'rejected'].includes(service.status)) throw new AppError(409, 'SERVICE_SUBMIT_NOT_AVAILABLE', 'This service cannot be submitted in its current state');
  assertPublishableCatalogueMedia(service.media, 'Service');
  if (service.paymentRule === 'deposit' && (!service.depositAmountMinor || service.depositAmountMinor >= service.basePriceMinor)) throw new AppError(400, 'INVALID_SERVICE_DEPOSIT', 'Deposit must be less than the service price');
  service.status = 'pending_review'; service.moderationStatus = 'pending'; service.rejectionReason = null;
  await service.save();
  return service;
}

function searchExpression(search) { return search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim(), 'i') : null; }

async function listPublicServices({ q, categoryId, businessSlug, businessIds, locationIds, page, limit, sort = 'newest' }) {
  const filter = { status: 'active', moderationStatus: 'approved' };
  const andFilters = [];
  if (categoryId) filter.categoryId = categoryId;
  if (businessSlug) {
    const business = await Business.findOne({ slug: businessSlug, status: 'active', moderationStatus: 'approved' }).select('_id');
    if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
    filter.businessId = business._id;
  }
  if (businessIds) filter.businessId = { $in: businessIds };
  if (locationIds) {
    andFilters.push({ $or: locationIds.length ? [{ locationIds: { $in: locationIds } }, { locationIds: { $size: 0 } }] : [{ locationIds: { $size: 0 } }] });
  }
  const expression = searchExpression(q);
  if (expression) andFilters.push({ $or: [{ name: expression }, { description: expression }, { shortDescription: expression }] });
  if (andFilters.length) filter.$and = andFilters;
  const sortValue = sort === 'price_low' ? { basePriceMinor: 1 } : sort === 'price_high' ? { basePriceMinor: -1 } : { createdAt: -1 };
  const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([Service.find(filter).sort(sortValue).skip(skip).limit(limit).populate('businessId', 'name slug status moderationStatus'), Service.countDocuments(filter)]);
  return { services: services.map((service) => ({ ...service.toCardJSON(), business: service.businessId ? { id: service.businessId._id.toString(), name: service.businessId.name, slug: service.businessId.slug } : null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function getPublicService(slug) {
  const service = await Service.findOne({ slug, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!service || !service.businessId || service.businessId.status !== 'active' || service.businessId.moderationStatus !== 'approved') throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found');
  return service;
}

async function listBusinessServices(businessId, { status, page, limit }) {
  const filter = { businessId }; if (status) filter.status = status;
  const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([Service.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Service.countDocuments(filter)]);
  return { services, total, page, limit, pages: Math.ceil(total / limit) };
}

async function listAdminServices({ status, page, limit }) {
  const filter = status ? { status } : {}; const skip = (page - 1) * limit;
  const [services, total] = await Promise.all([Service.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('businessId', 'name slug'), Service.countDocuments(filter)]);
  return { services, total, page, limit, pages: Math.ceil(total / limit) };
}

async function reviewService(serviceId, decision, reason) {
  const service = await Service.findById(serviceId); if (!service) throw new AppError(404, 'SERVICE_NOT_FOUND', 'Service not found');
  if (service.status !== 'pending_review') throw new AppError(409, 'SERVICE_REVIEW_NOT_AVAILABLE', 'This service is not awaiting review');
  if (decision === 'approve') {
    const business = await Business.findOne({ _id: service.businessId, status: 'active', moderationStatus: 'approved' });
    if (!business) throw new AppError(409, 'BUSINESS_NOT_READY_FOR_SERVICE', 'The parent business must be active and approved before a service can be published');
  }
  if (decision === 'approve') { service.status = 'active'; service.moderationStatus = 'approved'; service.publishedAt = new Date(); service.rejectionReason = null; } else { service.status = 'rejected'; service.moderationStatus = 'rejected'; service.rejectionReason = reason; }
  await service.save(); return service;
}

module.exports = { createService, updateService, submitService, listPublicServices, getPublicService, listBusinessServices, listAdminServices, reviewService, normalizeVariants, validateStaff, validateLocations, validateStaffAssignments };
