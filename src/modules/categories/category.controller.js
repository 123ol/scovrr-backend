const { asyncHandler } = require('../../common/http/asyncHandler');
const { sendSuccess } = require('../../common/http/response');
const categoryService = require('./category.service');

async function sendCategoryList(req, res, includeDisabled) {
  const categories = await categoryService.listCategories(req.query, includeDisabled);
  return sendSuccess(res, { categories: categories.map((category) => ({
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description || null,
    icon: category.icon || null,
    image: category.image || null,
    parentId: category.parent ? category.parent.toString() : null,
    type: category.type,
    sortOrder: category.sortOrder,
    enabled: category.enabled
  })) });
}

const list = asyncHandler(async (req, res) => sendCategoryList(req, res, false));
const listAdmin = asyncHandler(async (req, res) => sendCategoryList(req, res, req.query.includeDisabled === 'true'));

const create = asyncHandler(async (req, res) => {
  const category = await categoryService.createCategory(req.body);
  return res.status(201).json({ success: true, data: { category: category.toPublicJSON() } });
});

const update = asyncHandler(async (req, res) => {
  const category = await categoryService.updateCategory(req.params.categoryId, req.body);
  return sendSuccess(res, { category: category.toPublicJSON() });
});

module.exports = { list, listAdmin, create, update };
