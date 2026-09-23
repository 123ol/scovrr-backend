const { AppError } = require('../../common/errors/AppError');
const { PortfolioItem } = require('./portfolio.model');
const { Service } = require('./service.model');

async function validateService(businessId, serviceId) {
  if (!serviceId) return null;
  const service = await Service.findOne({ _id: serviceId, businessId });
  if (!service) throw new AppError(400, 'INVALID_PORTFOLIO_SERVICE', 'The selected service does not belong to this business');
  return service._id;
}

async function createPortfolioItem(businessId, input) {
  const serviceId = await validateService(businessId, input.serviceId);
  return PortfolioItem.create({ ...input, businessId, serviceId });
}

async function listPortfolioItems(businessId, { status, page, limit }) {
  const filter = { businessId }; if (status) filter.status = status;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([PortfolioItem.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit), PortfolioItem.countDocuments(filter)]);
  return { items: items.map((item) => item.toJSONSafe()), total, page, limit, pages: Math.ceil(total / limit) };
}

async function listPublicPortfolio(businessId) {
  const items = await PortfolioItem.find({ businessId, status: 'published' }).sort({ sortOrder: 1, createdAt: -1 }).limit(100);
  return items.map((item) => item.toJSONSafe());
}

async function updatePortfolioItem(businessId, portfolioId, input) {
  const item = await PortfolioItem.findOne({ _id: portfolioId, businessId }); if (!item) throw new AppError(404, 'PORTFOLIO_ITEM_NOT_FOUND', 'Portfolio item not found');
  if (input.serviceId !== undefined) item.serviceId = await validateService(businessId, input.serviceId);
  for (const field of ['title', 'description', 'media', 'tags', 'status', 'sortOrder']) if (input[field] !== undefined) item[field] = input[field];
  await item.save(); return item;
}

module.exports = { createPortfolioItem, listPortfolioItems, listPublicPortfolio, updatePortfolioItem, validateService };
