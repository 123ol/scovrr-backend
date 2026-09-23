const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { Category } = require('../src/modules/categories/category.model');

const roots = [
  { name: 'Fashion', slug: 'fashion', type: 'both', description: 'Fashion, clothing and style.' },
  { name: 'Beauty', slug: 'beauty', type: 'both', description: 'Beauty products and professionals.' },
  { name: 'Lifestyle Services', slug: 'lifestyle-services', type: 'service', description: 'Services that help you look and feel your best.' }
];

const children = [
  { name: 'Women', slug: 'women', type: 'product', parent: 'fashion' },
  { name: 'Men', slug: 'men', type: 'product', parent: 'fashion' },
  { name: 'Children', slug: 'children', type: 'product', parent: 'fashion' },
  { name: 'Thrift', slug: 'thrift', type: 'product', parent: 'fashion' },
  { name: 'Dresses', slug: 'dresses', type: 'product', parent: 'women' },
  { name: 'Clothing', slug: 'clothing', type: 'product', parent: 'fashion' },
  { name: 'Shoes', slug: 'shoes', type: 'product', parent: 'fashion' },
  { name: 'Bags', slug: 'bags', type: 'product', parent: 'fashion' },
  { name: 'Jewelry', slug: 'jewelry', type: 'product', parent: 'fashion' },
  { name: 'Makeup', slug: 'makeup', type: 'both', parent: 'beauty' },
  { name: 'Hair and Wigs', slug: 'hair-and-wigs', type: 'both', parent: 'beauty' },
  { name: 'Skincare', slug: 'skincare', type: 'product', parent: 'beauty' },
  { name: 'Nails', slug: 'nails', type: 'both', parent: 'beauty' },
  { name: 'Photography', slug: 'photography', type: 'service', parent: 'lifestyle-services' },
  { name: 'Tailoring', slug: 'tailoring', type: 'service', parent: 'lifestyle-services' },
  { name: 'Personal Styling', slug: 'personal-styling', type: 'service', parent: 'lifestyle-services' }
];

async function seed() {
  await connectDatabase();
  const rootIds = {};
  for (const input of roots) {
    const category = await Category.findOneAndUpdate(
      { slug: input.slug },
      { $set: { ...input, enabled: true }, $setOnInsert: { parent: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    rootIds[input.slug] = category._id;
  }

  const allParents = { ...rootIds };
  for (const input of children) {
    const parent = allParents[input.parent];
    if (!parent) throw new Error(`Missing seed parent ${input.parent}`);
    const category = await Category.findOneAndUpdate(
      { slug: input.slug },
      { $set: { name: input.name, type: input.type, parent, enabled: true }, $setOnInsert: { sortOrder: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    allParents[input.slug] = category._id;
  }
  console.info(`Seeded ${roots.length + children.length} categories.`);
}

seed()
  .catch((error) => {
    console.error('Unable to seed categories:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => disconnectDatabase().catch(() => undefined));
