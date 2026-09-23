const bcrypt = require('bcryptjs');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { Category } = require('../src/modules/categories/category.model');
const { User } = require('../src/modules/users/user.model');
const { Business } = require('../src/modules/businesses/business.model');
const { BusinessMembership } = require('../src/modules/businesses/business-membership.model');
const { permissionsForRole } = require('../src/modules/businesses/business-permissions');
const { Product } = require('../src/modules/products/product.model');
const { ProductPriceHistory } = require('../src/modules/products/product-price-history.model');

const SELLER_PASSWORD = process.env.SEED_SELLER_PASSWORD || '';
const IMAGE_BASE = 'https://placehold.co/800x800/160A2B/FFFFFF/png?text=';

const categoryDefinitions = [
  { name: 'Fashion', slug: 'fashion', type: 'both', description: 'Fashion, clothing and style.' },
  { name: 'Beauty', slug: 'beauty', type: 'both', description: 'Beauty products and professionals.' },
  { name: 'Clothing', slug: 'clothing', type: 'product', parentSlug: 'fashion' },
  { name: 'Shoes', slug: 'shoes', type: 'product', parentSlug: 'fashion' },
  { name: 'Bags', slug: 'bags', type: 'product', parentSlug: 'fashion' },
  { name: 'Jewelry', slug: 'jewelry', type: 'product', parentSlug: 'fashion' },
  { name: 'Hair and Wigs', slug: 'hair-and-wigs', type: 'both', parentSlug: 'beauty' }
];

const sellers = [
  {
    user: { firstName: 'Tola', lastName: 'Adebayo', email: 'tola.hair@scovrr.demo' },
    business: {
      name: 'Tola Crown Hair Studio',
      slug: 'tola-crown-hair-studio',
      description: 'A trusted hair studio for custom wigs, extensions and everyday hair care.',
      capabilities: ['marketplace', 'services'],
      categorySlugs: ['beauty', 'hair-and-wigs'],
      operatingModel: 'home_based',
      instagram: '@tolacrownhair'
    },
    products: [
      { name: 'HD Lace Frontal Wig', slug: 'hd-lace-frontal-wig', category: 'hair-and-wigs', price: 185000, compareAt: 210000, brand: 'Tola Crown', stock: 8, tags: ['wig', 'lace', 'human hair'], description: 'A natural-looking HD lace frontal wig with a soft, pre-plucked hairline.' },
      { name: 'Kinky Curly Hair Bundle', slug: 'kinky-curly-hair-bundle', category: 'hair-and-wigs', price: 95000, brand: 'Tola Crown', stock: 14, tags: ['bundles', 'kinky curly', 'human hair'], description: 'Full, bouncy kinky curly bundle for protective styles and custom units.' },
      { name: 'Silky Straight Hair Bundle', slug: 'silky-straight-hair-bundle', category: 'hair-and-wigs', price: 110000, brand: 'Tola Crown', stock: 11, tags: ['bundles', 'straight hair'], description: 'Smooth, versatile straight hair bundle with a natural shine.' },
      { name: 'Glueless Bob Wig', slug: 'glueless-bob-wig', category: 'hair-and-wigs', price: 135000, compareAt: 155000, brand: 'Tola Crown', stock: 6, tags: ['bob wig', 'glueless', 'short hair'], description: 'A polished glueless bob that is easy to wear and style.' },
      { name: 'Edge Control Styling Gel', slug: 'edge-control-styling-gel', category: 'hair-and-wigs', price: 8500, brand: 'Crown Care', stock: 30, tags: ['edge control', 'styling', 'hair care'], description: 'Long-lasting, non-flaking hold for clean edges and protective styles.' },
      { name: 'Rosemary Hair Growth Oil', slug: 'rosemary-hair-growth-oil', category: 'hair-and-wigs', price: 12000, brand: 'Crown Care', stock: 24, tags: ['hair oil', 'scalp care', 'rosemary'], description: 'A lightweight rosemary and castor oil blend for scalp massage and hair care.' },
      { name: 'Deep Repair Conditioning Mask', slug: 'deep-repair-conditioning-mask', category: 'hair-and-wigs', price: 14500, brand: 'Crown Care', stock: 18, tags: ['conditioner', 'deep treatment', 'hair care'], description: 'Rich moisture treatment for dry, colored or heat-styled hair.' },
      { name: 'Satin Bonnet and Scrunchie Set', slug: 'satin-bonnet-scrunchie-set', category: 'hair-and-wigs', price: 7500, brand: 'Crown Care', stock: 35, tags: ['satin', 'bonnet', 'night care'], description: 'A satin bonnet and matching scrunchie set to help protect your style overnight.' },
      { name: 'Detangling Brush Set', slug: 'detangling-brush-set', category: 'hair-and-wigs', price: 6500, brand: 'Crown Care', stock: 22, tags: ['brush', 'detangling', 'hair tools'], description: 'Two flexible brushes designed for gentle detangling on wet or dry hair.' },
      { name: 'Wig Care Starter Kit', slug: 'wig-care-starter-kit', category: 'hair-and-wigs', price: 22000, compareAt: 26000, brand: 'Tola Crown', stock: 12, tags: ['wig care', 'starter kit', 'hair tools'], description: 'A practical kit with wig spray, comb, edge brush, clips and a storage bag.' }
    ]
  },
  {
    user: { firstName: 'Maya', lastName: 'Okafor', email: 'maya.style@scovrr.demo' },
    business: {
      name: 'Maya Style House',
      slug: 'maya-style-house',
      description: 'A curated fashion shop for statement bags, shoes, clothing and jewelry.',
      capabilities: ['marketplace'],
      categorySlugs: ['fashion', 'bags', 'shoes', 'clothing', 'jewelry'],
      operatingModel: 'online_only',
      instagram: '@mayastylehouse'
    },
    products: [
      { name: 'Structured Leather Tote', slug: 'structured-leather-tote', category: 'bags', price: 68000, compareAt: 78000, brand: 'Maya Edit', stock: 10, tags: ['bag', 'tote', 'leather'], description: 'A structured everyday tote with a roomy interior and polished gold-tone details.' },
      { name: 'Quilted Mini Shoulder Bag', slug: 'quilted-mini-shoulder-bag', category: 'bags', price: 42000, brand: 'Maya Edit', stock: 13, tags: ['bag', 'shoulder bag', 'quilted'], description: 'A compact quilted shoulder bag for evenings, events and everyday essentials.' },
      { name: 'Classic Court Heels', slug: 'classic-court-heels', category: 'shoes', price: 52000, compareAt: 60000, brand: 'Maya Edit', stock: 9, tags: ['shoes', 'heels', 'office style'], description: 'Timeless pointed court heels with a comfortable mid-height silhouette.' },
      { name: 'Everyday White Sneakers', slug: 'everyday-white-sneakers', category: 'shoes', price: 39000, brand: 'Maya Edit', stock: 16, tags: ['shoes', 'sneakers', 'casual'], description: 'Clean white sneakers made for easy styling with denim, dresses and co-ords.' },
      { name: 'Linen Co-ord Set', slug: 'linen-co-ord-set', category: 'clothing', price: 58000, compareAt: 68000, brand: 'Maya Edit', stock: 12, tags: ['clothing', 'co-ord', 'linen'], description: 'A relaxed linen shirt and trouser co-ord for effortless warm-weather dressing.' },
      { name: 'Satin Slip Dress', slug: 'satin-slip-dress', category: 'clothing', price: 45000, brand: 'Maya Edit', stock: 10, tags: ['clothing', 'dress', 'satin'], description: 'A fluid satin slip dress with adjustable straps and an elegant drape.' },
      { name: 'Oversized Graphic Shirt', slug: 'oversized-graphic-shirt', category: 'clothing', price: 24000, brand: 'Maya Edit', stock: 20, tags: ['clothing', 'shirt', 'streetwear'], description: 'A relaxed oversized cotton shirt with a bold front graphic.' },
      { name: 'Layered Pendant Necklace', slug: 'layered-pendant-necklace', category: 'jewelry', price: 18000, brand: 'Maya Edit', stock: 25, tags: ['jewelry', 'necklace', 'gold tone'], description: 'A ready-to-wear layered pendant necklace that adds polish to simple looks.' },
      { name: 'Gold Hoop Earrings', slug: 'gold-hoop-earrings', category: 'jewelry', price: 9500, brand: 'Maya Edit', stock: 30, tags: ['jewelry', 'earrings', 'hoops'], description: 'Lightweight classic hoops with a bright gold-tone finish.' },
      { name: 'Beaded Bracelet Stack', slug: 'beaded-bracelet-stack', category: 'jewelry', price: 12500, brand: 'Maya Edit', stock: 28, tags: ['jewelry', 'bracelet', 'beaded'], description: 'A stack of colorful beaded bracelets designed to mix and match.' }
    ]
  }
];

function imageFor(name) {
  return `${IMAGE_BASE}${encodeURIComponent(name)}`;
}

async function ensureCategory(input, categoryMap) {
  const parent = input.parentSlug ? categoryMap[input.parentSlug] || await Category.findOne({ slug: input.parentSlug }) : null;
  if (input.parentSlug && !parent) throw new Error(`Missing category parent ${input.parentSlug}`);

  const category = await Category.findOneAndUpdate(
    { slug: input.slug },
    {
      $set: {
        name: input.name,
        type: input.type,
        description: input.description || undefined,
        parent: parent?._id || null,
        enabled: true
      },
      $setOnInsert: { sortOrder: 0 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  categoryMap[input.slug] = category;
  return category;
}

async function ensureSellerUser(input, passwordHash) {
  return User.findOneAndUpdate(
    { email: input.email },
    {
      $set: {
        firstName: input.firstName,
        lastName: input.lastName,
        status: 'active',
        emailVerifiedAt: new Date()
      },
      $setOnInsert: { passwordHash }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function ensureBusiness(input, ownerId, categoryMap) {
  const categories = input.categorySlugs.map((slug) => {
    const category = categoryMap[slug];
    if (!category) throw new Error(`Missing seller category ${slug}`);
    return category._id;
  });

  const existing = await Business.findOne({ slug: input.slug });
  if (existing && existing.ownerId.toString() !== ownerId.toString()) {
    throw new Error(`Business slug ${input.slug} belongs to another owner`);
  }

  return Business.findOneAndUpdate(
    { slug: input.slug },
    {
      $set: {
        name: input.name,
        description: input.description,
        ownerId,
        capabilities: input.capabilities,
        categories,
        operatingModel: input.operatingModel,
        status: 'active',
        moderationStatus: 'approved',
        verification: { status: 'approved', submittedAt: new Date(), reviewedAt: new Date(), reviewedBy: null, rejectionReason: null, adminNotes: 'Seeded demo seller' },
        socialAccounts: { instagram: input.instagram }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function ensureMembership(userId, businessId) {
  return BusinessMembership.findOneAndUpdate(
    { userId, businessId },
    {
      $set: {
        role: 'owner',
        permissions: permissionsForRole('owner'),
        status: 'active',
        joinedAt: new Date(),
        locationAccess: { mode: 'all', locationIds: [] }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function ensureProduct(input, business, categoryMap, actorId, now) {
  const slug = `${business.slug}-${input.slug}`;
  const existing = await Product.findOne({ slug });
  if (existing && existing.businessId.toString() !== business._id.toString()) {
    throw new Error(`Product slug ${slug} belongs to another business`);
  }

  const category = categoryMap[input.category];
  const fields = {
    businessId: business._id,
    categoryId: category._id,
    name: input.name,
    slug,
    description: input.description,
    shortDescription: input.description,
    brand: input.brand,
    condition: 'new',
    tags: input.tags,
    media: [{ url: imageFor(input.name), provider: 'seed', alt: input.name, order: 0, isCover: true }],
    basePriceMinor: input.price,
    compareAtPriceMinor: input.compareAt || null,
    currency: 'NGN',
    inventoryTracking: true,
    stockQuantity: input.stock,
    reservedQuantity: 0,
    availableQuantity: input.stock,
    lowStockThreshold: 2,
    variants: [],
    status: 'active',
    moderationStatus: 'approved',
    publishedAt: now,
    rejectionReason: null,
    ratingAverage: 4.5,
    ratingCount: 8
  };

  const product = existing || new Product(fields);
  if (existing) Object.assign(product, fields);
  await product.save();

  await ProductPriceHistory.findOneAndUpdate(
    { productId: product._id, reason: 'seed_marketplace_initial' },
    {
      $set: {
        businessId: business._id,
        actorId,
        basePriceMinor: product.basePriceMinor,
        currency: product.currency,
        variants: [],
        reason: 'seed_marketplace_initial'
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return product;
}

async function seed() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Marketplace demo data is disabled. Set ALLOW_DEMO_SEED=true with a non-production NODE_ENV only when intentionally seeding local development.');
  }
  if (SELLER_PASSWORD.length < 12) throw new Error('SEED_SELLER_PASSWORD must be at least 12 characters long');

  await connectDatabase();
  const passwordHash = await bcrypt.hash(SELLER_PASSWORD, 12);
  const categoryMap = {};

  for (const category of categoryDefinitions) await ensureCategory(category, categoryMap);

  const now = new Date();
  const summary = [];
  for (const seller of sellers) {
    const user = await ensureSellerUser(seller.user, passwordHash);
    const business = await ensureBusiness(seller.business, user._id, categoryMap);
    await ensureMembership(user._id, business._id);
    const products = [];
    for (const productInput of seller.products) products.push(await ensureProduct(productInput, business, categoryMap, user._id, now));
    summary.push({ email: user.email, business: business.name, products: products.length });
  }

  console.info('Seeded marketplace sellers and products:');
  for (const item of summary) console.info(`- ${item.business}: ${item.products} products (${item.email})`);
  console.info(`Demo seller password: ${SELLER_PASSWORD}`);
}

seed()
  .catch((error) => {
    console.error('Unable to seed marketplace:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => disconnectDatabase().catch(() => undefined));
