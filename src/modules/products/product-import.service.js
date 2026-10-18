const mongoose = require('mongoose');
const { AppError } = require('../../common/errors/AppError');
const { enqueueJob } = require('../../jobs/job.service');
const { Business } = require('../businesses/business.model');
const { ProductImportJob } = require('./product-import-job.model');
const productService = require('./product.service');

async function requestCsvImport({ business, actorId, csv }) {
  const drafts = productService.parseCsvProductDrafts(csv);
  const validation = await productService.bulkCreateProductDrafts(business, drafts, actorId, false);
  const job = await ProductImportJob.create({
    businessId: business._id,
    actorId,
    drafts,
    validated: validation.validated,
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000)
  });
  try {
    await enqueueJob({ type: 'product_import', payload: { productImportJobId: job._id.toString() }, idempotencyKey: `product-import:${job._id}` });
  } catch (error) {
    job.status = 'failed';
    job.errorCode = 'PRODUCT_IMPORT_QUEUE_UNAVAILABLE';
    await job.save();
    throw new AppError(503, 'PRODUCT_IMPORT_QUEUE_UNAVAILABLE', 'The product import could not be queued. Please try again.');
  }
  return job;
}

async function processCsvImport(productImportJobId) {
  const job = await ProductImportJob.findOneAndUpdate({ _id: productImportJobId, status: 'queued', expiresAt: { $gt: new Date() } }, { $set: { status: 'processing', startedAt: new Date() } }, { new: true }).select('+drafts');
  if (!job) return null;
  try {
    const business = await Business.findById(job.businessId);
    if (!business) throw new AppError(404, 'BUSINESS_NOT_FOUND', 'The business no longer exists');
    const result = await productService.bulkCreateProductDrafts(business, job.drafts, job.actorId, true);
    job.created = result.products.length;
    job.createdProductIds = result.products.map((product) => product._id);
    job.status = 'completed';
    job.completedAt = new Date();
    job.errorCode = null;
    await job.save();
  } catch (error) {
    job.status = 'failed';
    job.errorCode = error.code || 'PRODUCT_IMPORT_FAILED';
    await job.save();
  }
  return job;
}

async function getCsvImport(businessId, productImportJobId) {
  if (!mongoose.isValidObjectId(productImportJobId)) throw new AppError(404, 'PRODUCT_IMPORT_NOT_FOUND', 'Product import not found or expired');
  const job = await ProductImportJob.findOne({ _id: productImportJobId, businessId });
  if (!job) throw new AppError(404, 'PRODUCT_IMPORT_NOT_FOUND', 'Product import not found or expired');
  return job;
}

module.exports = { requestCsvImport, processCsvImport, getCsvImport };
