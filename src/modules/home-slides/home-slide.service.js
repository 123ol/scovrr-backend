const { AppError } = require('../../common/errors/AppError');
const { HomeSlide } = require('./home-slide.model');
const { Product } = require('../products/product.model');

const PRODUCT_FIELDS = 'name slug media basePriceMinor currency status moderationStatus businessId';

function activeDateFilter(now = new Date()) {
  return {
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }
    ]
  };
}

async function validateDestination(input) {
  const targetType = input.targetType || 'marketplace';
  if (targetType === 'marketplace') return { targetType, productId: null };
  if (!input.productId) throw new AppError(400, 'HOME_SLIDE_PRODUCT_REQUIRED', 'A product is required for a product slide');
  const product = await Product.findOne({ _id: input.productId, status: 'active', moderationStatus: 'approved' }).select('_id');
  if (!product) throw new AppError(400, 'HOME_SLIDE_PRODUCT_INVALID', 'The product must be active and approved before it can be featured');
  return { targetType, productId: product._id };
}

function slideQuery(query) {
  return query.populate({
    path: 'productId',
    match: { status: 'active', moderationStatus: 'approved' },
    select: PRODUCT_FIELDS
  });
}

async function listPublicHomeSlides(limit = 8) {
  const slides = await slideQuery(HomeSlide.find({ status: 'active', ...activeDateFilter() }))
    .sort({ sortOrder: 1, createdAt: -1 })
    .limit(limit);
  return { slides: slides.map((slide) => slide.toPublicJSON()) };
}

async function listAdminHomeSlides({ status, page = 1, limit = 25 }) {
  const filter = status ? { status } : {};
  const skip = (page - 1) * limit;
  const [slides, total] = await Promise.all([
    slideQuery(HomeSlide.find(filter)).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit),
    HomeSlide.countDocuments(filter)
  ]);
  return { slides: slides.map((slide) => slide.toAdminJSON()), total, page, limit, pages: Math.ceil(total / limit) };
}

async function createHomeSlide(input, actorId) {
  const destination = await validateDestination(input);
  const slide = await HomeSlide.create({ ...input, ...destination, createdBy: actorId, updatedBy: actorId });
  return slideQuery(HomeSlide.findById(slide._id)).then((result) => result);
}

async function updateHomeSlide(slideId, input, actorId) {
  const slide = await HomeSlide.findById(slideId);
  if (!slide) throw new AppError(404, 'HOME_SLIDE_NOT_FOUND', 'Home slide not found');

  const merged = {
    targetType: input.targetType !== undefined ? input.targetType : slide.targetType,
    productId: input.productId !== undefined ? input.productId : slide.productId,
    startsAt: input.startsAt !== undefined ? input.startsAt : slide.startsAt,
    endsAt: input.endsAt !== undefined ? input.endsAt : slide.endsAt
  };
  if (merged.startsAt && merged.endsAt && merged.endsAt <= merged.startsAt) {
    throw new AppError(400, 'HOME_SLIDE_DATE_RANGE_INVALID', 'End date must be after the start date');
  }
  const destination = await validateDestination(merged);
  for (const field of ['eyebrow', 'title', 'subtitle', 'imageUrl', 'sortOrder', 'status', 'startsAt', 'endsAt']) {
    if (input[field] !== undefined) slide[field] = input[field];
  }
  slide.targetType = destination.targetType;
  slide.productId = destination.productId;
  slide.updatedBy = actorId;
  await slide.save();
  return slideQuery(HomeSlide.findById(slide._id)).then((result) => result);
}

async function archiveHomeSlide(slideId, actorId) {
  const slide = await HomeSlide.findById(slideId);
  if (!slide) throw new AppError(404, 'HOME_SLIDE_NOT_FOUND', 'Home slide not found');
  slide.status = 'archived';
  slide.updatedBy = actorId;
  await slide.save();
  return slide;
}

module.exports = { listPublicHomeSlides, listAdminHomeSlides, createHomeSlide, updateHomeSlide, archiveHomeSlide };
