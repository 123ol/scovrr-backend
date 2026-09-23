const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { Category } = require('../src/modules/categories/category.model');
const { DEFAULT_SELLER_CATEGORIES } = require('../src/modules/categories/default-categories');

async function seed() {
  await connectDatabase();
  const slugs = DEFAULT_SELLER_CATEGORIES.map((category) => category.slug);
  await Category.updateMany({ slug: { $nin: slugs } }, { $set: { enabled: false } });
  for (const [sortOrder, input] of DEFAULT_SELLER_CATEGORIES.entries()) {
    await Category.findOneAndUpdate(
      { slug: input.slug },
      { $set: { ...input, type: 'both', parent: null, sortOrder, enabled: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  console.info(`Seeded ${DEFAULT_SELLER_CATEGORIES.length} shared seller categories.`);
}

seed()
  .catch((error) => {
    console.error('Unable to seed categories:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => disconnectDatabase().catch(() => undefined));
