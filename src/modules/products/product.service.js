const { AppError } = require('../../common/errors/AppError');
const { slugify } = require('../../common/slug');
const { Product } = require('./product.model');
const { Business } = require('../businesses/business.model');
const { Category } = require('../categories/category.model');
const { ProductPriceHistory } = require('./product-price-history.model');
const entitlementService = require('../subscriptions/entitlement.service');
const { sanitizeCatalogueMedia, assertPublishableCatalogueMedia } = require('../media/catalogue-media.service');
const { productBody } = require('./product.validation');
const { rankSearchResults, rankByBusinessOrder } = require('../discovery/search-ranking');

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
  if (!business.capabilities.includes('marketplace')) throw new AppError(400, 'MARKETPLACE_CAPABILITY_REQUIRED', 'This business cannot publish products until marketplace capability is enabled');
  if (!categoryId) return null;
  const category = await Category.findOne({ _id: categoryId, enabled: true }).select('type');
  if (!category) throw new AppError(400, 'INVALID_PRODUCT_CATEGORY', 'The selected category is unavailable');
  if (category.type !== 'both' && category.type !== 'product') {
    throw new AppError(400, 'CATEGORY_CAPABILITY_MISMATCH', 'The category does not match this business capability');
  }
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

async function bulkUpdateProducts(business, updates, actorId = null) {
  const ids = updates.map((item) => item.productId);
  if (new Set(ids.map(String)).size !== ids.length) throw new AppError(400, 'DUPLICATE_PRODUCT_UPDATE', 'Each product may appear only once in a bulk update');
  const existing = await Product.find({ _id: { $in: ids }, businessId: business._id }).select('_id').lean();
  if (existing.length !== ids.length) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'One or more products do not belong to this business');
  const products = [];
  for (const item of updates) products.push(await updateProduct(business, item.productId, item.patch, actorId));
  return products;
}

async function bulkCreateProductDrafts(business, products, actorId = null, commit = false) {
  if (!commit) return { committed: false, validated: products.length, products: [] };
  const created = [];
  for (const input of products) created.push(await createProduct(business, input, actorId));
  return { committed: true, validated: products.length, products: created };
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ',' && !quoted) { values.push(value.trim()); value = ''; continue; }
    value += character;
  }
  values.push(value.trim());
  if (quoted) throw new AppError(400, 'INVALID_PRODUCT_CSV', 'The product CSV contains an unterminated quoted value');
  return values;
}

function csvHeaderKey(value) {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function csvCell(row, headers, ...names) {
  const index = names.map(csvHeaderKey).map((name) => headers.indexOf(name)).find((candidate) => candidate >= 0);
  return index === undefined ? '' : row[index] || '';
}

function parseCsvNumber(value, label, rowNumber, { integer = false, required = false } = {}) {
  if (!String(value || '').trim()) {
    if (required) throw new AppError(400, 'INVALID_PRODUCT_CSV', `Row ${rowNumber}: ${label} is required`);
    return undefined;
  }
  const parsed = Number(String(value).replaceAll(',', '').trim());
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) throw new AppError(400, 'INVALID_PRODUCT_CSV', `Row ${rowNumber}: ${label} must be a valid ${integer ? 'integer' : 'number'}`);
  return parsed;
}

function parseCsvProductDrafts(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new AppError(400, 'INVALID_PRODUCT_CSV', 'The product CSV must include a header and at least one product row');
  const headers = parseCsvLine(lines[0]).map(csvHeaderKey);
  if (!headers.includes('name')) throw new AppError(400, 'INVALID_PRODUCT_CSV', 'The product CSV must include a name column');
  if (!headers.includes('price') && !headers.includes('base_price_minor')) throw new AppError(400, 'INVALID_PRODUCT_CSV', 'The product CSV must include price or base_price_minor');
  const dataLines = lines.slice(1);
  if (dataLines.length > 25) throw new AppError(400, 'INVALID_PRODUCT_CSV', 'A product CSV may contain at most 25 rows per request');
  return dataLines.map((line, lineIndex) => {
    const rowNumber = lineIndex + 2;
    const row = parseCsvLine(line);
    if (row.length > headers.length) throw new AppError(400, 'INVALID_PRODUCT_CSV', `Row ${rowNumber}: more values were supplied than the header defines`);
    const name = csvCell(row, headers, 'name');
    const basePriceMinor = headers.includes('base_price_minor') && csvCell(row, headers, 'base_price_minor')
      ? parseCsvNumber(csvCell(row, headers, 'base_price_minor'), 'base_price_minor', rowNumber, { integer: true, required: true })
      : Math.round(parseCsvNumber(csvCell(row, headers, 'price'), 'price', rowNumber, { required: true }) * 100);
    const stockQuantity = parseCsvNumber(csvCell(row, headers, 'stock_quantity', 'stock'), 'stock', rowNumber, { integer: true }) ?? 0;
    if (stockQuantity < 0) throw new AppError(400, 'INVALID_PRODUCT_CSV', `Row ${rowNumber}: stock cannot be negative`);
    const compareAtCell = csvCell(row, headers, 'compare_at_price', 'compare_at_price_minor');
    const compareAtValue = headers.includes('compare_at_price_minor') && compareAtCell
      ? parseCsvNumber(compareAtCell, 'compare_at_price_minor', rowNumber, { integer: true })
      : (compareAtCell ? Math.round(parseCsvNumber(compareAtCell, 'compare_at_price', rowNumber) * 100) : undefined);
    const rawTags = csvCell(row, headers, 'tags');
    const input = {
      name,
      description: csvCell(row, headers, 'description') || undefined,
      shortDescription: csvCell(row, headers, 'short_description') || undefined,
      brand: csvCell(row, headers, 'brand') || undefined,
      condition: csvCell(row, headers, 'condition') || 'new',
      tags: rawTags ? rawTags.split(/[|;]/).map((tag) => tag.trim()).filter(Boolean) : [],
      media: [],
      basePriceMinor,
      compareAtPriceMinor: compareAtValue,
      currency: (csvCell(row, headers, 'currency') || 'NGN').toUpperCase(),
      inventoryTracking: !['false', '0', 'no'].includes(csvCell(row, headers, 'inventory_tracking').toLowerCase()),
      stockQuantity,
      lowStockThreshold: parseCsvNumber(csvCell(row, headers, 'low_stock_threshold'), 'low_stock_threshold', rowNumber, { integer: true }) ?? 0,
      variants: []
    };
    const parsed = productBody.safeParse(input);
    if (!parsed.success) throw new AppError(400, 'INVALID_PRODUCT_CSV', `Row ${rowNumber}: ${parsed.error.issues[0]?.message || 'invalid product fields'}`);
    return parsed.data;
  });
}

function duplicateProductFilter({ businessId, name, categoryId = null, productId = null }) {
  return { businessId, name: new RegExp(`^${escapeRegExp(name.trim())}$`, 'i'), status: { $ne: 'archived' }, ...(categoryId ? { categoryId } : {}), ...(productId ? { _id: { $ne: productId } } : {}) };
}

async function findDuplicateProducts(input) {
  const filter = duplicateProductFilter(input);
  const products = await Product.find(filter).sort({ updatedAt: -1 }).limit(20);
  return products.map((product) => product.toOwnerJSON());
}

async function exportBusinessProducts(businessId, { status } = {}) {
  const products = await Product.find({ businessId, ...(status ? { status } : {}) }).sort({ createdAt: -1 }).limit(5_000);
  return products.map((product) => ({
    id: product._id.toString(),
    name: product.name,
    slug: product.slug,
    status: product.status,
    moderationStatus: product.moderationStatus,
    condition: product.condition,
    currency: product.currency,
    basePriceMinor: product.basePriceMinor,
    stockQuantity: product.stockQuantity,
    reservedQuantity: product.reservedQuantity,
    availableQuantity: product.availableQuantity,
    lowStockThreshold: product.lowStockThreshold,
    variants: product.variants.map((variant) => ({ name: variant.name, sku: variant.sku || null, priceMinor: variant.priceMinor || product.basePriceMinor, stockQuantity: variant.stockQuantity, availableQuantity: variant.availableQuantity }))
  }));
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

async function listPublicProducts({ search, categoryId, businessSlug, businessIds, businessOrder, page, limit, sort = 'newest', minPriceMinor, maxPriceMinor, condition }) {
  const filter = { status: 'active', moderationStatus: 'approved' };
  let business;
  if (businessSlug) {
    business = await Business.findOne({ slug: businessSlug, status: 'active', moderationStatus: 'approved' }).select('_id name slug');
    if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'Business not found');
    filter.businessId = business._id;
  }
  if (businessIds) filter.businessId = { $in: businessIds };
  if (minPriceMinor !== undefined || maxPriceMinor !== undefined) filter.basePriceMinor = { ...(minPriceMinor !== undefined ? { $gte: minPriceMinor } : {}), ...(maxPriceMinor !== undefined ? { $lte: maxPriceMinor } : {}) };
  if (condition) filter.condition = condition;
  if (categoryId) filter.categoryId = categoryId;
  if (search) {
    const expression = new RegExp(escapeRegExp(search.trim()), 'i');
    filter.$or = [{ name: expression }, { description: expression }, { shortDescription: expression }, { brand: expression }, { tags: expression }];
  }
  const relevanceSearch = Boolean(search && sort === 'newest');
  const sortValue = sort === 'price_low' ? { basePriceMinor: 1 } : sort === 'price_high' ? { basePriceMinor: -1 } : { createdAt: -1 };
  const skip = (page - 1) * limit;
  const locationAware = !search && Array.isArray(businessOrder) && businessOrder.length > 0;
  const candidateLimit = relevanceSearch || locationAware ? Math.min(500, Math.max(limit * 5, skip + limit)) : limit;
  const [products, total] = await Promise.all([
    Product.find(filter).sort(sortValue).skip(relevanceSearch || locationAware ? 0 : skip).limit(candidateLimit).populate('businessId', 'name slug'),
    Product.countDocuments(filter)
  ]);
  const ranked = relevanceSearch ? rankSearchResults(products, search, (product) => [
    { value: product.name, weight: 10 },
    { value: product.brand, weight: 7 },
    { value: product.tags, weight: 5 },
    { value: product.shortDescription, weight: 3 },
    { value: product.description, weight: 2 }
  ], { businessOrder, getBusinessId: (product) => product.businessId }) : (locationAware ? rankByBusinessOrder(products, businessOrder, (product) => product.businessId) : products);
  return { products: ranked.slice(relevanceSearch || locationAware ? skip : 0, relevanceSearch || locationAware ? skip + limit : limit).map((product) => ({ ...product.toCardJSON(), business: product.businessId ? { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } : null })), total, page, limit, pages: Math.ceil(total / limit) };
}

async function getPublicProduct(slug) {
  const product = await Product.findOne({ slug, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!product || !product.businessId || product.businessId.status !== 'active' || product.businessId.moderationStatus !== 'approved') throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return product;
}

async function comparePublicProducts(ids) {
  const uniqueIds = [...new Set(ids.map((id) => id.toString()))];
  const products = await Product.find({ _id: { $in: uniqueIds }, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  const visible = products.filter((product) => product.businessId?.status === 'active' && product.businessId?.moderationStatus === 'approved');
  if (visible.length !== uniqueIds.length) throw new AppError(404, 'PRODUCTS_NOT_AVAILABLE', 'One or more products are no longer available for comparison');
  const byId = new Map(visible.map((product) => [product._id.toString(), product]));
  return uniqueIds.map((id) => byId.get(id)).map((product) => ({ ...product.toPublicJSON(), business: { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } }));
}

async function similarPublicProducts(slug, { limit = 8 } = {}) {
  const source = await Product.findOne({ slug, status: 'active', moderationStatus: 'approved' }).populate('businessId', 'name slug status moderationStatus');
  if (!source || !source.businessId || source.businessId.status !== 'active' || source.businessId.moderationStatus !== 'approved') throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const signals = [];
  if (source.categoryId) signals.push({ categoryId: source.categoryId });
  if (source.tags?.length) signals.push({ tags: { $in: source.tags } });
  if (!signals.length) return { products: [], sourceProductId: source._id.toString() };
  const candidates = await Product.find({ _id: { $ne: source._id }, businessId: { $ne: source.businessId._id }, status: 'active', moderationStatus: 'approved', $or: signals }).sort({ ratingCount: -1, createdAt: -1 }).limit(Math.min(Math.max(Number(limit) || 8, 1), 20)).populate('businessId', 'name slug status moderationStatus');
  const visible = candidates.filter((product) => product.businessId?.status === 'active' && product.businessId?.moderationStatus === 'approved');
  return { sourceProductId: source._id.toString(), products: visible.map((product) => ({ ...product.toCardJSON(), business: { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } })) };
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

module.exports = { createProduct, updateProduct, bulkUpdateProducts, bulkCreateProductDrafts, parseCsvProductDrafts, findDuplicateProducts, duplicateProductFilter, exportBusinessProducts, submitProduct, listPublicProducts, getPublicProduct, comparePublicProducts, similarPublicProducts, listBusinessProducts, listAdminProducts, reviewProduct, normalizeVariants, uniqueProductSlug, escapeRegExp, validateCategory };
