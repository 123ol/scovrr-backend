const { AppError } = require('../../common/errors/AppError');
const { slugify } = require('../../common/slug');
const { Product } = require('./product.model');
const { Business } = require('../businesses/business.model');
const { Category } = require('../categories/category.model');
const { ProductPriceHistory } = require('./product-price-history.model');
const entitlementService = require('../subscriptions/entitlement.service');
const { sanitizeCatalogueMedia, assertPublishableCatalogueMedia } = require('../media/catalogue-media.service');

function normalizeVariants(variants = [], basePriceMinor, existingVariants = []) {
  const skus = new Set();
  const existingById = new Map(existingVariants.map((variant) => [variant.variantId.toString(), variant]));
  return variants.map((variant) => {
    if (variant.sku) {
      if (skus.has(variant.sku.toLowerCase())) throw new AppError(400, 'DUPLICATE_VARIANT_SKU', 'Variant SKUs must be unique within a product');
      skus.add(variant.sku.toLowerCase());
    }
    const existing = variant.variantId ? existingById.get(variant.variantId.toString()) : null;
    const inventoryTracking = existing ? existing.inventoryTracking : variant.inventoryTracking;
    const stockQuantity = existing ? existing.stockQuantity : (inventoryTracking ? variant.stockQuantity : 0);
    return {
      ...variant,
      variantId: existing?.variantId || variant.variantId,
      inventoryTracking,
      priceMinor: variant.priceMinor || basePriceMinor,
      stockQuantity,
      reservedQuantity: existing?.reservedQuantity || 0,
      availableQuantity: existing ? existing.availableQuantity : stockQuantity,
      lowStockThreshold: existing ? existing.lowStockThreshold : variant.lowStockThreshold
    };
  });
}

async function uniqueProductSlug(business, name) {
  const base = `${slugify(business.slug)}-${slugify(name)}`.slice(0, 170);
  let candidate = base;
  let suffix = 2;
  while (await Product.exists({ slug: candidate })) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function validateCategory(categoryId, business) {
  if (!categoryId) return null;
  const category = await Category.findOne({ _id: categoryId, enabled: true }).select('type');
  if (!category) throw new AppError(400, 'INVALID_PRODUCT_CATEGORY', 'The selected category is unavailable');
  if (category.type !== 'both' && !business.capabilities.includes(category.type === 'product' ? 'marketplace' : 'services')) {
    throw new AppError(400, 'CATEGORY_CAPABILITY_MISMATCH', 'The category does not match this business capability');
  }
  if (!business.capabilities.includes('marketplace')) throw new AppError(400, 'MARKETPLACE_CAPABILITY_REQUIRED', 'This business cannot publish products until marketplace capability is enabled');
  return category._id;
}

async function createProduct(business, input, actorId = null) {
  await entitlementService.assertFeature(business._id, 'marketplace.enabled');
  await entitlementService.assertWithinLimit(business._id, 'commerce.products.max', 1);
  const categoryId = await validateCategory(input.categoryId, business);
  const media = await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: input.media, field: 'Product media' });
  const variants = await Promise.all((input.variants || []).map(async (variant) => ({ ...variant, media: await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: variant.media, field: 'Product variant media' }) })));
  const normalizedVariants = normalizeVariants(variants, input.basePriceMinor);
  const stockQuantity = input.inventoryTracking && variants.length === 0 ? input.stockQuantity : 0;
  const product = await Product.create({
    businessId: business._id,
    categoryId,
    name: input.name,
    slug: await uniqueProductSlug(business, input.name),
    description: input.description || '',
    shortDescription: input.shortDescription || '',
    brand: input.brand,
    condition: input.condition,
    tags: input.tags,
    media,
    basePriceMinor: input.basePriceMinor,
    compareAtPriceMinor: input.compareAtPriceMinor,
    currency: input.currency,
    inventoryTracking: input.inventoryTracking,
    stockQuantity,
    reservedQuantity: 0,
    availableQuantity: stockQuantity,
    lowStockThreshold: input.lowStockThreshold,
    variants: normalizedVariants,
    status: 'draft',
    moderationStatus: 'pending'
  });
  await ProductPriceHistory.create({ productId: product._id, businessId: business._id, actorId, basePriceMinor: product.basePriceMinor, currency: product.currency, variants: product.variants.map((variant) => ({ variantId: variant.variantId, name: variant.name, priceMinor: variant.priceMinor, currency: product.currency })), reason: 'catalogue_price_initial' });
  return product;
}

async function updateProduct(business, productId, input, actorId = null) {
  const product = await Product.findOne({ _id: productId, businessId: business._id });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (input.categoryId !== undefined) product.categoryId = await validateCategory(input.categoryId, business);
  if (input.name !== undefined) product.name = input.name;
  if (input.description !== undefined) product.description = input.description;
  if (input.shortDescription !== undefined) product.shortDescription = input.shortDescription;
  if (input.brand !== undefined) product.brand = input.brand;
  if (input.condition !== undefined) product.condition = input.condition;
  if (input.tags !== undefined) product.tags = input.tags;
  if (input.media !== undefined) product.media = await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: input.media, field: 'Product media' });
  const priceChanged = input.basePriceMinor !== undefined || input.currency !== undefined || input.variants !== undefined;
  if (input.basePriceMinor !== undefined) product.basePriceMinor = input.basePriceMinor;
  if (input.compareAtPriceMinor !== undefined) product.compareAtPriceMinor = input.compareAtPriceMinor;
  if (input.currency !== undefined) product.currency = input.currency;
  if (input.lowStockThreshold !== undefined) product.lowStockThreshold = input.lowStockThreshold;
  if (input.inventoryTracking !== undefined && product.variants.length === 0) product.inventoryTracking = input.inventoryTracking;
  if (input.variants !== undefined) {
    const incomingIds = new Set(input.variants.filter((variant) => variant.variantId).map((variant) => variant.variantId));
    if (product.variants.some((variant) => variant.reservedQuantity > 0 && !incomingIds.has(variant.variantId.toString()))) {
      throw new AppError(409, 'VARIANT_RESERVATION_CONFLICT', 'A variant with an active checkout reservation cannot be removed');
    }
    const variants = await Promise.all(input.variants.map(async (variant) => ({ ...variant, media: await sanitizeCatalogueMedia({ businessId: business._id, actorId, media: variant.media, field: 'Product variant media' }) })));
    product.variants = normalizeVariants(variants, input.basePriceMinor || product.basePriceMinor, product.variants);
  }
  if (product.status === 'active' || product.status === 'sold_out') {
    product.status = 'draft';
    product.moderationStatus = 'pending';
    product.publishedAt = null;
  }
  await product.save();
  if (priceChanged) await ProductPriceHistory.create({ productId: product._id, businessId: business._id, actorId, basePriceMinor: product.basePriceMinor, currency: product.currency, variants: product.variants.map((variant) => ({ variantId: variant.variantId, name: variant.name, priceMinor: variant.priceMinor, currency: product.currency })) });
  return product;
}

async function submitProduct(businessId, productId) {
  const product = await Product.findOne({ _id: productId, businessId });
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (!['draft', 'rejected'].includes(product.status)) throw new AppError(409, 'PRODUCT_SUBMIT_NOT_AVAILABLE', 'This product cannot be submitted in its current state');
  assertPublishableCatalogueMedia(product.media, 'Product');
  if (product.variants.length === 0 && product.inventoryTracking && product.stockQuantity < 0) throw new AppError(400, 'INVALID_PRODUCT_STOCK', 'Product stock is invalid');
  product.status = 'pending_review';
  product.moderationStatus = 'pending';
  product.rejectionReason = null;
  await product.save();
  return product;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listPublicProducts({ search, categoryId, businessSlug, businessIds, page, limit, sort = 'newest' }) {
  const filter = { status: 'active', moderationStatus: 'approved' };
  let business;
  if (businessSlug) {
    business = await Business.findOne({ slug: businessSlug, status: 'active', moderationStatus: 'approved' }).select('_id name slug');
    if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
    filter.businessId = business._id;
  }
  if (businessIds) filter.businessId = { $in: businessIds };
  if (categoryId) filter.categoryId = categoryId;
  if (search) {
    const expression = new RegExp(escapeRegExp(search.trim()), 'i');
    filter.$or = [{ name: expression }, { description: expression }, { shortDescription: expression }, { brand: expression }, { tags: expression }];
  }
  const sortValue = sort === 'price_low' ? { basePriceMinor: 1 } : sort === 'price_high' ? { basePriceMinor: -1 } : { createdAt: -1 };
  const skip = (page - 1) * limit;
  const [products, total] = await Promise.all([
    Product.find(filter).sort(sortValue).skip(skip).limit(limit).populate('businessId', 'name slug'),
    Product.countDocuments(filter)
  ]);
  return { products: products.map((product) => ({ ...product.toCardJSON(), business: product.businessId ? { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } : null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function getPublicProduct(slug) {
  const product = await Product.findOne({ slug, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!product || !product.businessId || product.businessId.status !== 'active' || product.businessId.moderationStatus !== 'approved') throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return product;
}

async function listBusinessProducts(businessId, { status, page, limit }) {
  const filter = { businessId };
  if (status) filter.status = status;
  const skip = (page - 1) * limit;
  const [products, total] = await Promise.all([Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Product.countDocuments(filter)]);
  return { products, total, page, limit, pages: Math.ceil(total / limit) };
}

async function listAdminProducts({ status, page, limit }) {
  const filter = status ? { status } : {};
  const skip = (page - 1) * limit;
  const [products, total] = await Promise.all([Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('businessId', 'name slug'), Product.countDocuments(filter)]);
  return { products, total, page, limit, pages: Math.ceil(total / limit) };
}

async function reviewProduct(productId, adminId, decision, reason) {
  const product = await Product.findById(productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (product.status !== 'pending_review') throw new AppError(409, 'PRODUCT_REVIEW_NOT_AVAILABLE', 'This product is not awaiting review');
  if (decision === 'approve') {
    const hasAvailableStock = product.variants.length > 0
      ? product.variants.some((variant) => !variant.inventoryTracking || variant.availableQuantity > 0)
      : !product.inventoryTracking || product.availableQuantity > 0;
    product.status = hasAvailableStock ? 'active' : 'sold_out';
    product.moderationStatus = 'approved';
    product.publishedAt = new Date();
    product.rejectionReason = null;
  } else {
    product.status = 'rejected';
    product.moderationStatus = 'rejected';
    product.rejectionReason = reason;
  }
  await product.save();
  return product;
}

module.exports = { createProduct, updateProduct, submitProduct, listPublicProducts, getPublicProduct, listBusinessProducts, listAdminProducts, reviewProduct, normalizeVariants, uniqueProductSlug, escapeRegExp };
