const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const { AppError } = require('../../common/errors/AppError');
const { Product } = require('./product.model');
const productService = require('./product.service');
const inventoryService = require('../inventory/inventory.service');
const { recordAudit } = require('../audit/audit.service');
const moderationService = require('../moderation/moderation.service');
const { canAccessLocation } = require('../../middleware/business-access');
const promotionService = require('../promotions/promotion.service');
const recentlyViewedService = require('../discovery/recently-viewed.service');
const productImportService = require('./product-import.service');

const create = asyncHandler(async (req, res) => {
  const product = await productService.createProduct(req.business, req.body, req.auth.userId);
  return res.status(201).json({ success: true, data: { product: product.toOwnerJSON() } });
});

const update = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(req.business, req.params.productId, req.body, req.auth.userId);
  return sendSuccess(res, { product: product.toOwnerJSON() });
});

const bulkUpdate = asyncHandler(async (req, res) => {
  const products = await productService.bulkUpdateProducts(req.business, req.body.updates, req.auth.userId);
  return sendSuccess(res, { products: products.map((product) => product.toOwnerJSON()), updated: products.length });
});

const bulkCreate = asyncHandler(async (req, res) => {
  const result = await productService.bulkCreateProductDrafts(req.business, req.body.products, req.auth.userId, req.body.commit);
  return res.status(result.committed ? 201 : 200).json({ success: true, data: { committed: result.committed, validated: result.validated, products: result.products.map((product) => product.toOwnerJSON()) } });
});

const bulkCreateCsv = asyncHandler(async (req, res) => {
  const products = productService.parseCsvProductDrafts(req.body.csv);
  const result = await productService.bulkCreateProductDrafts(req.business, products, req.auth.userId, req.body.commit);
  return res.status(result.committed ? 201 : 200).json({ success: true, data: { committed: result.committed, validated: result.validated, products: result.products.map((product) => product.toOwnerJSON()) } });
});

const requestCsvImport = asyncHandler(async (req, res) => res.status(202).json({ success: true, data: { productImportJob: (await productImportService.requestCsvImport({ business: req.business, actorId: req.auth.userId, csv: req.body.csv })).toSafeJSON() } }));
const getCsvImport = asyncHandler(async (req, res) => sendSuccess(res, { productImportJob: (await productImportService.getCsvImport(req.business._id, req.params.importJobId)).toSafeJSON() }));

const submit = asyncHandler(async (req, res) => {
  const product = await productService.submitProduct(req.business._id, req.params.productId);
  return sendSuccess(res, { product: product.toOwnerJSON() });
});

const manageList = asyncHandler(async (req, res) => {
  const result = await productService.listBusinessProducts(req.business._id, req.query);
  return sendSuccess(res, { ...result, products: result.products.map((product) => product.toOwnerJSON()) });
});
const duplicates = asyncHandler(async (req, res) => sendSuccess(res, { products: await productService.findDuplicateProducts({ businessId: req.business._id, ...req.query }) }));
const exportProducts = asyncHandler(async (req, res) => {
  const products = await productService.exportBusinessProducts(req.business._id, req.query);
  if (req.query.format === 'csv') {
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const lines = [['ID', 'Name', 'Slug', 'Status', 'Moderation status', 'Condition', 'Currency', 'Base price minor', 'Stock', 'Reserved', 'Available', 'Low stock threshold', 'Variants'], ...products.map((product) => [product.id, product.name, product.slug, product.status, product.moderationStatus, product.condition, product.currency, product.basePriceMinor, product.stockQuantity, product.reservedQuantity, product.availableQuantity, product.lowStockThreshold, product.variants.map((variant) => `${variant.name}${variant.sku ? ` (${variant.sku})` : ''}: ${variant.availableQuantity}`).join(' | ')])];
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="scovrr-products-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(lines.map((line) => line.map(escape).join(',')).join('\n'));
  }
  return sendSuccess(res, { products, limit: 5_000 });
});

const publicList = asyncHandler(async (req, res) => sendSuccess(res, await productService.listPublicProducts({ ...req.query, businessSlug: req.params.businessSlug })));
const compare = asyncHandler(async (req, res) => sendSuccess(res, { products: await productService.comparePublicProducts(req.query.ids) }));
const similar = asyncHandler(async (req, res) => sendSuccess(res, await productService.similarPublicProducts(req.params.slug, req.query)));

const publicBySlug = asyncHandler(async (req, res) => {
  const product = await productService.getPublicProduct(req.params.slug);
  if (req.auth?.userId) {
    try { await recentlyViewedService.recordView(req.auth.userId, { targetType: 'product', targetId: product._id }); } catch (_error) { /* browsing must not fail if history storage is unavailable */ }
  }
  const line = { type: 'product', productId: product._id, categoryId: product.categoryId, businessId: product.businessId._id, lineTotalMinor: product.basePriceMinor };
  const pricing = await promotionService.calculatePricing({ businessId: product.businessId._id, currency: product.currency, subtotalMinor: product.basePriceMinor, lines: [line], kind: 'order' });
  return sendSuccess(res, { product: { ...product.toPublicJSON(), discountPreview: pricing.discountMinor > 0 ? { discountMinor: pricing.discountMinor, finalPriceMinor: pricing.totalBeforeDeliveryMinor, promotion: pricing.promotion?.toSafeJSON() || null } : null }, business: product.businessId ? { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } : null });
});

const adjustInventory = asyncHandler(async (req, res) => {
  if (req.body.locationId && !canAccessLocation(req.businessMembership, req.body.locationId)) throw new AppError(403, 'BUSINESS_LOCATION_ACCESS_REQUIRED', 'You do not have access to this branch');
  const result = await inventoryService.adjustInventory({ businessId: req.business._id, locationId: req.body.locationId, productId: req.params.productId, variantId: req.body.variantId, delta: req.body.delta, actorId: req.auth.userId, reason: req.body.reason });
  const product = result.product || result;
  return sendSuccess(res, { product: product.toOwnerJSON(), position: result.position?.toSafeJSON() || null });
});

const adminList = asyncHandler(async (req, res) => {
  const result = await productService.listAdminProducts(req.query);
  return sendSuccess(res, { ...result, products: result.products.map((product) => ({ ...product.toOwnerJSON(), business: product.businessId ? { id: product.businessId._id.toString(), name: product.businessId.name, slug: product.businessId.slug } : null })) });
});

const adminApprove = asyncHandler(async (req, res) => {
  const target = await Product.findById(req.params.productId);
  if (!target) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const item = await moderationService.createOrAttachCase({ subjectType: 'product', subjectId: target._id, businessId: target.businessId, source: 'admin', reason: 'admin_review', severity: 'low' });
  const decision = await moderationService.decideCase(item._id, req.auth.userId, 'approved', 'Approved through catalogue review.');
  const approvedProduct = decision.item ? await Product.findById(target._id) : target;
  await recordAudit({ actorId: req.auth.userId, action: 'PRODUCT_MODERATED', targetType: 'product', targetId: approvedProduct._id, after: approvedProduct.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { product: approvedProduct.toOwnerJSON() });
});

const adminReject = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const item = await moderationService.createOrAttachCase({ subjectType: 'product', subjectId: product._id, businessId: product.businessId, source: 'admin', reason: 'admin_review', severity: 'low' });
  const decision = await moderationService.decideCase(item._id, req.auth.userId, 'rejected', req.body.reason);
  const rejectedProduct = decision.item ? await Product.findById(product._id) : product;
  await recordAudit({ actorId: req.auth.userId, action: 'PRODUCT_MODERATED', targetType: 'product', targetId: rejectedProduct._id, reason: req.body.reason, after: rejectedProduct.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { product: rejectedProduct.toOwnerJSON() });
});

const adminSuspend = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId);
  if (!product) throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
  if (product.status !== 'active' || product.moderationStatus !== 'approved') throw new AppError(409, 'PRODUCT_SUSPEND_NOT_AVAILABLE', 'Only an approved live product can be suspended');
  const item = await moderationService.createOrAttachCase({ subjectType: 'product', subjectId: product._id, businessId: product.businessId, source: 'admin', reason: 'admin_suspension', severity: 'medium' });
  const decision = await moderationService.decideCase(item._id, req.auth.userId, 'removed', req.body.reason);
  const suspendedProduct = decision.item ? await Product.findById(product._id) : product;
  await recordAudit({ actorId: req.auth.userId, action: 'PRODUCT_MODERATED', targetType: 'product', targetId: suspendedProduct._id, reason: req.body.reason, before: product.toOwnerJSON(), after: suspendedProduct.toOwnerJSON(), ipAddress: req.ip, userAgent: req.get('user-agent'), correlationId: req.get('x-request-id') || null });
  return sendSuccess(res, { product: suspendedProduct.toOwnerJSON() });
});

module.exports = { create, update, bulkCreate, bulkCreateCsv, requestCsvImport, getCsvImport, bulkUpdate, submit, manageList, duplicates, exportProducts, publicList, compare, similar, publicBySlug, adjustInventory, adminList, adminApprove, adminReject, adminSuspend };
