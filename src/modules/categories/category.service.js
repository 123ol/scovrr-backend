const { AppError } = require('../../common/errors/AppError');
const { slugify } = require('../../common/slug');
const { Category } = require('./category.model');
const { DEFAULT_SELLER_CATEGORIES } = require('./default-categories');

let defaultCategoriesReady = false;
let defaultCategoriesPromise = null;

async function ensureDefaultCategories() {
  if (defaultCategoriesReady) return;
  if (!defaultCategoriesPromise) {
    defaultCategoriesPromise = Promise.all(DEFAULT_SELLER_CATEGORIES.map((category, sortOrder) => Category.updateOne(
      { slug: category.slug },
      { $setOnInsert: { ...category, type: 'both', parent: null, sortOrder, enabled: true } },
      { upsert: true }
    ))).then(() => {
      defaultCategoriesReady = true;
    }).finally(() => {
      defaultCategoriesPromise = null;
    });
  }
  await defaultCategoriesPromise;
}

async function ensureParentIsValid(parentId, categoryId, type) {
  if (!parentId) return null;
  if (categoryId && parentId.toString() === categoryId.toString()) {
    throw new AppError(400, 'CATEGORY_LOOP', 'A category cannot be its own parent');
  }

  const parent = await Category.findById(parentId);
  if (!parent) throw new AppError(400, 'PARENT_CATEGORY_NOT_FOUND', 'The parent category does not exist');
  if (type && parent.type !== 'both' && type !== 'both' && parent.type !== type) {
    throw new AppError(400, 'CATEGORY_TYPE_MISMATCH', 'A category must be compatible with its parent category');
  }

  let current = parent.parent;
  const visited = new Set([parent._id.toString()]);
  while (current) {
    const currentId = current.toString();
    if (visited.has(currentId) || (categoryId && currentId === categoryId.toString())) {
      throw new AppError(400, 'CATEGORY_LOOP', 'The category hierarchy would create a loop');
    }
    visited.add(currentId);
    const ancestor = await Category.findById(current).select('parent');
    current = ancestor?.parent || null;
  }
  return parent;
}

async function createCategory(input) {
  const parent = await ensureParentIsValid(input.parentId, null, input.type);
  const category = await Category.create({
    name: input.name,
    slug: slugify(input.slug || input.name),
    description: input.description,
    icon: input.icon,
    image: input.image,
    parent: parent?._id || null,
    type: input.type,
    sortOrder: input.sortOrder,
    enabled: input.enabled,
    metadata: input.metadata
  });
  return category;
}

async function listCategories(query = {}, includeDisabled = false) {
  await ensureDefaultCategories();
  const filter = includeDisabled ? {} : { enabled: true };
  if (query.type) filter.type = query.type === 'both' ? 'both' : { $in: [query.type, 'both'] };
  return Category.find(filter).sort({ parent: 1, sortOrder: 1, name: 1 }).lean();
}

async function updateCategory(categoryId, input) {
  const category = await Category.findById(categoryId);
  if (!category) throw new AppError(404, 'CATEGORY_NOT_FOUND', 'Category not found');

  const nextType = input.type || category.type;
  if (input.parentId !== undefined) await ensureParentIsValid(input.parentId, categoryId, nextType);
  if (input.slug || input.name) category.slug = slugify(input.slug || input.name);
  if (input.name !== undefined) category.name = input.name;
  if (input.description !== undefined) category.description = input.description;
  if (input.icon !== undefined) category.icon = input.icon;
  if (input.image !== undefined) category.image = input.image;
  if (input.parentId !== undefined) category.parent = input.parentId;
  if (input.type !== undefined) category.type = input.type;
  if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
  if (input.enabled !== undefined) category.enabled = input.enabled;
  if (input.metadata !== undefined) category.metadata = input.metadata;
  await category.save();
  return category;
}

module.exports = { createCategory, listCategories, updateCategory, ensureParentIsValid, ensureDefaultCategories };
