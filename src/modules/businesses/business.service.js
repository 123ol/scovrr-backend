const { AppError } = require('../../common/errors/AppError');
const { slugify } = require('../../common/slug');
const { Business } = require('./business.model');
const { BusinessMembership, permissionsForRole } = require('./business-membership.model');
const { BusinessLocation } = require('./business-location.model');
const { Category } = require('../categories/category.model');
const { assertUserCanActById } = require('../users/user-status.service');
const entitlementService = require('../subscriptions/entitlement.service');
const { Booking } = require('../bookings/booking.model');
const { Order } = require('../orders/order.model');
const { Product } = require('../products/product.model');
const { Service } = require('../services/service.model');
const { AvailabilityRule } = require('../availability/availability.model');
const { InventoryPosition } = require('../inventory/inventory-position.model');
const { User } = require('../users/user.model');
const { Follow } = require('../follows/follow.model');
const { UserFollow } = require('../follows/user-follow.model');
const { DEFAULT_SELLER_CATEGORIES } = require('../categories/default-categories');
const { EvidenceAsset } = require('../evidence/evidence-asset.model');

async function uniqueBusinessSlug(name) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (await Business.exists({ slug: candidate })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function resolveCategoryIds(categoryIds = [], categorySlugs = []) {
  if (categorySlugs.length) {
    const requestedSlugs = [...new Set(categorySlugs)];
    let categories = await Category.find({ slug: { $in: requestedSlugs }, enabled: true }).select('_id slug');
    const foundSlugs = new Set(categories.map((category) => category.slug));
    const defaultsToCreate = DEFAULT_SELLER_CATEGORIES.filter((category) => requestedSlugs.includes(category.slug) && !foundSlugs.has(category.slug));
    if (defaultsToCreate.length) {
      await Category.bulkWrite(defaultsToCreate.map((category) => ({
        updateOne: {
          filter: { slug: category.slug },
          update: { $set: { name: category.name, icon: category.icon, description: category.description, type: 'both', parent: null, enabled: true, sortOrder: DEFAULT_SELLER_CATEGORIES.indexOf(category) } },
          upsert: true
        }
      })));
      categories = await Category.find({ slug: { $in: requestedSlugs }, enabled: true }).select('_id slug');
    }
    if (categories.length !== requestedSlugs.length) throw new AppError(400, 'INVALID_BUSINESS_CATEGORIES', 'One or more categories are unavailable');
    return requestedSlugs.map((slug) => categories.find((category) => category.slug === slug)._id);
  }
  return categoryIds || [];
}

async function validateCategories(categoryIds, capabilities, categorySlugs = []) {
  categoryIds = await resolveCategoryIds(categoryIds, categorySlugs);
  if (!categoryIds?.length) return [];
  const categories = await Category.find({ _id: { $in: categoryIds }, enabled: true }).select('_id type');
  if (categories.length !== new Set(categoryIds).size) {
    throw new AppError(400, 'INVALID_BUSINESS_CATEGORIES', 'One or more categories are unavailable');
  }
  const types = new Set(capabilities);
  const compatible = categories.every((category) => category.type === 'both' || types.has(category.type));
  if (!compatible) throw new AppError(400, 'CATEGORY_CAPABILITY_MISMATCH', 'Selected categories do not match the business capabilities');
  return categories.map((category) => category._id);
}

async function createBusiness(userId, input) {
  await assertUserCanActById(userId);
  const categories = await validateCategories(input.categoryIds, input.capabilities, input.categorySlugs);
  // Fail before creating business records when production has not been bootstrapped
  // with the mandatory Free plan. This avoids an orphan business/membership pair.
  await entitlementService.assertFreePlanConfigured();
  const business = await Business.create({
    name: input.name,
    slug: await uniqueBusinessSlug(input.name),
    description: input.description || '',
    ownerId: userId,
    capabilities: input.capabilities,
    categories,
    operatingModel: input.operatingModel,
    status: 'draft',
    verification: { status: 'draft' }
  });

  await BusinessLocation.create({
    businessId: business._id,
    name: 'Main location',
    address: input.location.address,
    location: input.location.coordinates ? { type: 'Point', coordinates: input.location.coordinates } : undefined,
    publiclyVisible: true,
    pickupAvailable: input.capabilities.includes('marketplace'),
    primary: true,
    active: true
  });

  await BusinessMembership.create({
    userId,
    businessId: business._id,
    role: 'owner',
    permissions: permissionsForRole('owner'),
    status: 'active',
    joinedAt: new Date()
  });
  await User.findByIdAndUpdate(userId, {
    $set: {
      accountType: 'seller',
      location: {
        type: 'Point',
        coordinates: input.location.coordinates,
        city: input.location.address.city,
        state: input.location.address.state,
        country: input.location.address.country,
        capturedAt: new Date()
      }
    }
  });
  // A seller account cannot follow sellers or users. Remove follows created
  // while this account was a buyer as part of the irreversible upgrade.
  await Promise.all([
    Follow.deleteMany({ userId }),
    UserFollow.deleteMany({ followerId: userId })
  ]);
  // Every business has an explicit FREE subscription from creation; paid plans
  // are activated only through the verified subscription payment lifecycle.
  await entitlementService.getOrCreateBusinessSubscription(business._id);
  await require('../analytics/domain-event.service').queue('BUSINESS_CREATED', { userId, actorType: 'user', businessId: business._id, entityType: 'business', entityId: business._id, metadata: { businessId: business._id.toString(), source: 'APP' } }, `business:${business._id}:created`);
  return business;
}

async function listUserBusinesses(userId) {
  const memberships = await BusinessMembership.find({ userId, status: 'active' }).sort({ createdAt: 1 }).populate('businessId');
  return memberships.filter((membership) => membership.businessId).map((membership) => ({
    membership: membership.toJSONSafe(),
    business: membership.businessId.toOwnerJSON()
  }));
}

async function getPublicBusinessBySlug(slug) {
  const business = await Business.findOne({ slug, status: 'active', moderationStatus: 'approved' });
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  return business;
}

async function getPublicStorefront(business) {
  const storefront = business.storefront || {};
  const [products, services] = await Promise.all([
    Product.find({ _id: { $in: storefront.featuredProductIds || [] }, businessId: business._id, status: 'active', moderationStatus: 'approved' }).sort({ publishedAt: -1 }),
    Service.find({ _id: { $in: storefront.featuredServiceIds || [] }, businessId: business._id, status: 'active', moderationStatus: 'approved' }).sort({ publishedAt: -1 })
  ]);
  return {
    ...business.toPublicJSON().storefront,
    featuredProducts: products.map((product) => product.toCardJSON()),
    featuredServices: services.map((service) => service.toCardJSON())
  };
}

async function updateStorefront(business, input) {
  const productIds = [...new Set(input.featuredProductIds || [])];
  const serviceIds = [...new Set(input.featuredServiceIds || [])];
  const [productCount, serviceCount] = await Promise.all([
    Product.countDocuments({ _id: { $in: productIds }, businessId: business._id }),
    Service.countDocuments({ _id: { $in: serviceIds }, businessId: business._id })
  ]);
  if (productCount !== productIds.length) throw new AppError(400, 'INVALID_FEATURED_PRODUCTS', 'Every featured product must belong to this business');
  if (serviceCount !== serviceIds.length) throw new AppError(400, 'INVALID_FEATURED_SERVICES', 'Every featured service must belong to this business');
  business.storefront = {
    ...(business.storefront?.toObject ? business.storefront.toObject() : business.storefront || {}),
    ...input,
    featuredProductIds: productIds,
    featuredServiceIds: serviceIds,
    faqs: (input.faqs || []).map((faq, index) => ({ ...faq, order: faq.order ?? index }))
  };
  await business.save();
  return business;
}

async function updateMessaging(business, input) {
  const quickReplyTemplates = [...new Set((input.quickReplyTemplates || business.messaging?.quickReplyTemplates || []).map((value) => value.trim()).filter(Boolean))].slice(0, 6);
  business.messaging = { greetingEnabled: Boolean(input.greetingEnabled), greetingText: input.greetingText || '', quickReplyTemplates };
  await business.save();
  return business;
}

async function updateCapabilities(business, capabilities) {
  const categoryIds = await validateCategories(business.categories.map((category) => category.toString()), capabilities);
  business.capabilities = capabilities;
  business.categories = categoryIds;
  if (['active', 'pending_review', 'rejected'].includes(business.status)) {
    business.status = 'draft';
    business.verification.status = 'draft';
    business.verification.submittedAt = null;
  }
  await business.save();
  return business;
}

async function addLocation(businessId, input) {
  const count = await BusinessLocation.countDocuments({ businessId, active: true });
  await entitlementService.assertWithinLimit(businessId, 'business.locations.max', 1);
  const primary = input.primary || count === 0;
  const location = await BusinessLocation.create({
    businessId,
    name: input.name,
    code: input.code,
    address: input.address,
    contactPhone: input.contactPhone,
    location: input.coordinates ? { type: 'Point', coordinates: input.coordinates } : undefined,
    timezone: input.timezone,
    openingHours: input.openingHours,
    specialHours: input.specialHours,
    publiclyVisible: input.publiclyVisible,
    publicExactAddress: input.publicExactAddress,
    serviceAvailable: input.serviceAvailable,
    pickupAvailable: input.pickupAvailable,
    pickupInstructions: input.pickupInstructions,
    pickupPreparationMinutes: input.pickupPreparationMinutes,
    delivery: input.delivery,
    primary,
    active: input.active
  });
  if (primary) await BusinessLocation.updateMany({ businessId, _id: { $ne: location._id } }, { $set: { primary: false } });
  return location;
}

async function listLocations(businessId, includePrivate = false) {
  const business = includePrivate
    ? await Business.findById(businessId).select('status moderationStatus')
    : await Business.findOne({ _id: businessId, status: 'active', moderationStatus: 'approved' }).select('_id');
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  const filter = { businessId, ...(includePrivate ? {} : { active: true, publiclyVisible: true }) };
  const locations = await BusinessLocation.find(filter).sort({ createdAt: 1 });
  return locations.map((location) => location.toJSONSafe(includePrivate));
}

async function updateLocation(businessId, locationId, input) {
  const location = await BusinessLocation.findOne({ _id: locationId, businessId });
  if (!location) throw new AppError(404, 'LOCATION_NOT_FOUND', 'Business location not found');
  const willBeActive = input.active === undefined ? location.active : input.active;
  const existingCoordinates = location.location?.coordinates;
  if (willBeActive && !input.coordinates && (!Array.isArray(existingCoordinates) || existingCoordinates.length !== 2)) {
    throw new AppError(400, 'BUSINESS_LOCATION_REQUIRED', 'An active seller location must include valid coordinates');
  }
  if (input.active === false && location.active) {
    const [futureBookings, activeOrders, inventoryRemaining, staffSchedules] = await Promise.all([
      Booking.exists({ locationId, status: { $in: ['pending_payment', 'requested', 'confirmed', 'upcoming', 'checked_in', 'in_progress'] }, startAt: { $gt: new Date() } }),
      Order.exists({ fulfillmentLocationId: locationId, status: { $nin: ['completed', 'cancelled', 'refunded'] } }),
      InventoryPosition.exists({ locationId, $or: [{ quantityOnHand: { $gt: 0 } }, { quantityReserved: { $gt: 0 } }] }),
      AvailabilityRule.exists({ locationId })
    ]);
    if (futureBookings || activeOrders || inventoryRemaining || staffSchedules) {
      throw new AppError(409, 'LOCATION_HAS_ACTIVE_COMMITMENTS', 'Resolve the active branch commitments before deactivating this location', {
        futureBookings: Boolean(futureBookings),
        activeOrders: Boolean(activeOrders),
        inventoryRemaining: Boolean(inventoryRemaining),
        staffSchedules: Boolean(staffSchedules)
      });
    }
    if (location.primary) throw new AppError(409, 'PRIMARY_LOCATION_REQUIRED', 'Set another location as primary before deactivating this location');
  }
  if (input.name !== undefined) location.name = input.name;
  if (input.code !== undefined) location.code = input.code;
  if (input.address !== undefined) location.address = { ...location.address.toObject(), ...input.address };
  if (input.contactPhone !== undefined) location.contactPhone = input.contactPhone;
  if (input.coordinates !== undefined) location.location = { type: 'Point', coordinates: input.coordinates };
  if (input.timezone !== undefined) location.timezone = input.timezone;
  if (input.openingHours !== undefined) location.openingHours = input.openingHours;
  if (input.specialHours !== undefined) location.specialHours = input.specialHours;
  if (input.publiclyVisible !== undefined) location.publiclyVisible = input.publiclyVisible;
  if (input.publicExactAddress !== undefined) location.publicExactAddress = input.publicExactAddress;
  if (input.serviceAvailable !== undefined) location.serviceAvailable = input.serviceAvailable;
  if (input.pickupAvailable !== undefined) location.pickupAvailable = input.pickupAvailable;
  if (input.pickupInstructions !== undefined) location.pickupInstructions = input.pickupInstructions;
  if (input.pickupPreparationMinutes !== undefined) location.pickupPreparationMinutes = input.pickupPreparationMinutes;
  if (input.delivery !== undefined) location.delivery = { ...location.delivery.toObject(), ...input.delivery };
  if (input.primary === true) {
    await BusinessLocation.updateMany({ businessId, _id: { $ne: locationId } }, { $set: { primary: false } });
    location.primary = true;
  }
  if (input.active !== undefined) location.active = input.active;
  await location.save();
  return location;
}

async function submitBusiness(business) {
  if (business.capabilities.length < 1) {
    throw new AppError(400, 'BUSINESS_CAPABILITY_REQUIRED', 'At least one capability is required');
  }
  const hasActiveLocation = await BusinessLocation.exists({
    businessId: business._id,
    active: true,
    'location.coordinates.0': { $exists: true },
    'location.coordinates.1': { $exists: true }
  });
  if (!hasActiveLocation) {
    throw new AppError(400, 'BUSINESS_LOCATION_REQUIRED', 'Add an active shop location before submitting this business');
  }
  if (!['draft', 'rejected'].includes(business.status) && !(business.status === 'pending_review' && business.verification?.status === 'additional_information_required')) {
    throw new AppError(409, 'BUSINESS_SUBMIT_NOT_AVAILABLE', 'This business cannot be submitted in its current state');
  }
  business.status = 'pending_review';
  business.verification.status = 'submitted';
  business.verification.submittedAt = new Date();
  business.verification.rejectionReason = null;
  await business.save();
  return business;
}

async function attachVerificationEvidence(business, userId, evidenceAssetIds) {
  if (business.ownerId.toString() !== userId.toString()) {
    throw new AppError(403, 'BUSINESS_OWNER_REQUIRED', 'Only the business owner can submit verification evidence');
  }
  if (!['draft', 'rejected'].includes(business.status) && business.verification?.status !== 'additional_information_required') {
    throw new AppError(409, 'VERIFICATION_EVIDENCE_NOT_AVAILABLE', 'Verification evidence cannot be changed while this business is awaiting review');
  }
  const { attachEvidence } = require('../evidence/evidence.service');
  const snapshots = await attachEvidence({
    userId,
    purpose: 'verification',
    subject: { id: business._id, subjectType: 'business', subjectId: business._id },
    evidenceAssetIds,
    visibility: 'admin_only'
  });
  const current = (business.verification?.evidenceAssetIds || []).map((id) => id.toString());
  business.verification.evidenceAssetIds = [...new Set([...current, ...snapshots.map((item) => item.evidenceId.toString())])];
  await business.save();
  return business;
}

function businessAdminFilter({ status, search, operatingModel, verificationStatus, moderationStatus, capability } = {}) {
  const filter = {
    ...(status ? { status } : {}),
    ...(operatingModel ? { operatingModel } : {}),
    ...(verificationStatus ? { 'verification.status': verificationStatus } : {}),
    ...(moderationStatus ? { moderationStatus } : {}),
    ...(capability ? { capabilities: capability } : {})
  };
  if (search?.trim()) {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: new RegExp(escaped, 'i') }, { slug: new RegExp(escaped, 'i') }, { description: new RegExp(escaped, 'i') }];
  }
  return filter;
}

async function listBusinessesForAdmin({ status, search, operatingModel, verificationStatus, moderationStatus, capability, page, limit }) {
  const filter = businessAdminFilter({ status, search, operatingModel, verificationStatus, moderationStatus, capability });
  const skip = (page - 1) * limit;
  const [businesses, total] = await Promise.all([
    Business.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Business.countDocuments(filter)
  ]);
  return { businesses, total, page, limit, pages: Math.ceil(total / limit) };
}

async function getAdminDetail(businessId) {
  const business = await Business.findById(businessId);
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  const [locations, members, productCount, serviceCount, verificationEvidence] = await Promise.all([
    BusinessLocation.find({ businessId }).sort({ primary: -1, createdAt: 1 }),
    BusinessMembership.find({ businessId }).sort({ role: 1, createdAt: 1 }).populate('userId', 'firstName lastName email status'),
    Product.countDocuments({ businessId }),
    Service.countDocuments({ businessId }),
    EvidenceAsset.find({ _id: { $in: business.verification?.evidenceAssetIds || [] } }).select('_id documentType type mimeType originalName sizeBytes status createdAt').sort({ createdAt: 1 }).lean()
  ]);
  return { business, locations, members, counts: { products: productCount, services: serviceCount }, verificationEvidence };
}

async function reviewBusiness(businessId, adminId, decision, details = {}) {
  const business = await Business.findById(businessId);
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  if (business.status !== 'pending_review' && business.status !== 'rejected') {
    throw new AppError(409, 'BUSINESS_REVIEW_NOT_AVAILABLE', 'This business is not awaiting review');
  }

  business.verification.reviewedAt = new Date();
  business.verification.reviewedBy = adminId;
  business.verification.adminNotes = details.adminNotes || business.verification.adminNotes;
  if (decision === 'approve') {
    business.status = 'active';
    business.moderationStatus = 'approved';
    business.verification.status = 'approved';
    business.verification.level = business.verification.level === 'enhanced' ? 'enhanced' : 'verified';
    business.verification.rejectionReason = null;
  } else if (decision === 'request_information') {
    business.status = 'pending_review';
    business.moderationStatus = 'pending';
    business.verification.status = 'additional_information_required';
    business.verification.rejectionReason = details.reason;
  } else {
    business.status = 'rejected';
    business.moderationStatus = 'rejected';
    business.verification.status = 'rejected';
    business.verification.rejectionReason = details.reason;
  }
  await business.save();
  return business;
}

async function changeAdminStatus(businessId, adminId, status, reason) {
  const business = await Business.findById(businessId);
  if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  if (status === 'suspended') {
    if (business.status === 'suspended') return { business, before: business.toOwnerJSON() };
    if (business.status !== 'active') throw new AppError(409, 'BUSINESS_NOT_SUSPENDABLE', 'Only active businesses can be suspended');
    const before = business.toOwnerJSON();
    business.status = 'suspended';
    business.suspension = { reason, suspendedBy: adminId, suspendedAt: new Date(), restoredBy: null, restoredAt: null };
    await business.save();
    return { business, before };
  }
  if (business.status !== 'suspended') return { business, before: business.toOwnerJSON() };
  if (business.moderationStatus !== 'approved' || business.verification?.status !== 'approved') throw new AppError(409, 'BUSINESS_RESTORE_REQUIRES_APPROVAL', 'A suspended business must remain approved before reactivation');
  const before = business.toOwnerJSON();
  business.status = 'active';
  business.suspension.restoredBy = adminId;
  business.suspension.restoredAt = new Date();
  business.suspension.reason = reason;
  await business.save();
  return { business, before };
}

module.exports = { createBusiness, listUserBusinesses, getPublicBusinessBySlug, getPublicStorefront, updateStorefront, updateMessaging, updateCapabilities, addLocation, listLocations, updateLocation, submitBusiness, attachVerificationEvidence, listBusinessesForAdmin, businessAdminFilter, getAdminDetail, reviewBusiness, changeAdminStatus, validateCategories, uniqueBusinessSlug };
