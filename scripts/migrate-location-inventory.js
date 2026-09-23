const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { Business } = require('../src/modules/businesses/business.model');
const { BusinessLocation } = require('../src/modules/businesses/business-location.model');
const { Product } = require('../src/modules/products/product.model');
const { InventoryPosition } = require('../src/modules/inventory/inventory-position.model');
const { InventoryReservation } = require('../src/modules/inventory/inventory-reservation.model');
const {
  chooseMigrationLocation,
  readLegacyInventory,
  sameInventoryValues,
  positionValues,
  sumPositionValues
} = require('../src/modules/inventory/location-inventory-backfill');

const MAX_SAMPLES = 100;

function parseArgs(argv = []) {
  const args = { dryRun: false, limit: null, businessId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') args.dryRun = true;
    else if (argument === '--limit') args.limit = Number.parseInt(argv[++index], 10);
    else if (argument === '--business-id') args.businessId = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) throw new Error('--limit must be a positive integer');
  if (args.businessId && !mongoose.Types.ObjectId.isValid(args.businessId)) throw new Error('--business-id must be a valid MongoDB ObjectId');
  return args;
}

function issue(report, type, details) {
  report[type] += 1;
  if (report.samples[type].length < MAX_SAMPLES) report.samples[type].push(details);
}

function buildItem(product, variant = null) {
  return {
    productId: product._id,
    businessId: product.businessId,
    variantId: variant?.variantId || null,
    variantKey: variant ? String(variant.variantId || '') : 'base',
    isVariant: Boolean(variant),
    label: variant ? `${product.name} / ${variant.name || variant.variantId}` : product.name,
    source: variant || product
  };
}

function idString(value) { return value?.toString?.() || String(value); }

function reportItem(item) {
  return { productId: idString(item.productId), businessId: idString(item.businessId), variantId: item.variantId ? idString(item.variantId) : null, label: item.label };
}

function createReport({ dryRun, limit, businessId }) {
  return {
    dryRun,
    limit,
    businessId: businessId || null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    businessesScanned: 0,
    productsScanned: 0,
    variantsScanned: 0,
    inventoryPositionsCreated: 0,
    inventoryPositionsSkipped: 0,
    reservationsReassigned: 0,
    zeroStockRecords: 0,
    malformedValues: 0,
    conflicts: 0,
    missingLocations: 0,
    samples: {
      malformedValues: [],
      conflicts: [],
      missingLocations: [],
      created: [],
      skipped: []
    }
  };
}

async function migrateItem({ item, location, locationSource, positions, report, dryRun }) {
  const parsed = readLegacyInventory(item.source);
  const itemReport = reportItem(item);

  if (item.isVariant && !item.variantId) {
    issue(report, 'malformedValues', { ...itemReport, fields: [{ field: 'variantId', value: null }] });
    return;
  }

  if (!parsed.valid) {
    if (parsed.malformed.length > 0) {
      issue(report, 'malformedValues', { ...itemReport, fields: parsed.malformed });
    } else {
      issue(report, 'conflicts', { ...itemReport, code: 'LEGACY_STOCK_INCONSISTENT', reasons: parsed.conflicts });
    }
    return;
  }

  if (parsed.values.stockQuantity === 0) report.zeroStockRecords += 1;
  if (!location) {
    issue(report, 'missingLocations', { ...itemReport, code: locationSource || 'NO_VALID_MIGRATION_LOCATION' });
    return;
  }

  const legacyReservations = await InventoryReservation.collection.find({
    businessId: item.businessId,
    productId: item.productId,
    variantId: item.variantId || null,
    locationId: null,
    status: 'active'
  }).toArray();
  const reservationQuantity = legacyReservations.reduce((sum, reservation) => sum + (reservation.quantity || 0), 0);
  if (legacyReservations.some((reservation) => !Number.isInteger(reservation.quantity) || reservation.quantity < 1) || reservationQuantity > parsed.values.reservedQuantity) {
    issue(report, 'conflicts', { ...itemReport, code: 'LEGACY_RESERVATION_CONFLICT', reservationQuantity, legacyReservedQuantity: parsed.values.reservedQuantity });
    return;
  }

  const matchingPositions = positions.filter((position) => (position.variantKey || (position.variantId ? idString(position.variantId) : 'base')) === item.variantKey);
  const primaryPosition = matchingPositions.find((position) => idString(position.locationId) === idString(location._id));

  if (primaryPosition) {
    const values = positionValues(primaryPosition);
    if (!sameInventoryValues(values, parsed.values)) {
      issue(report, 'conflicts', { ...itemReport, code: 'PRIMARY_POSITION_CONFLICT', positionId: idString(primaryPosition._id), legacy: parsed.values, position: values });
      return;
    }
    report.inventoryPositionsSkipped += 1;
    if (report.samples.skipped.length < MAX_SAMPLES) report.samples.skipped.push({ ...itemReport, reason: 'already_migrated', positionId: idString(primaryPosition._id) });
  } else if (matchingPositions.length > 0) {
    issue(report, 'conflicts', { ...itemReport, code: 'POSITION_EXISTS_OUTSIDE_PRIMARY', existingPositionIds: matchingPositions.slice(0, 10).map((position) => idString(position._id)), aggregate: sumPositionValues(matchingPositions), legacy: parsed.values });
    return;
  } else {
    if (!dryRun) {
      await InventoryPosition.create({
        businessId: item.businessId,
        locationId: location._id,
        productId: item.productId,
        variantId: item.variantId,
        variantKey: item.variantKey,
        inventoryTracking: item.source.inventoryTracking !== false,
        quantityOnHand: parsed.values.stockQuantity,
        quantityReserved: parsed.values.reservedQuantity,
        quantityAvailable: parsed.values.availableQuantity,
        lowStockThreshold: item.source.lowStockThreshold || 0
      });
    }
    report.inventoryPositionsCreated += 1;
    if (report.samples.created.length < MAX_SAMPLES) report.samples.created.push({ ...itemReport, locationId: idString(location._id), locationSource });
  }

  if (legacyReservations.length > 0) {
    if (!dryRun) await InventoryReservation.collection.updateMany({ _id: { $in: legacyReservations.map((reservation) => reservation._id) }, locationId: null, status: 'active' }, { $set: { locationId: location._id } });
    report.reservationsReassigned += legacyReservations.length;
  }
}

async function runBackfill({ dryRun = false, limit = null, businessId = null, logger = console } = {}) {
  const report = createReport({ dryRun, limit, businessId });
  const productFilter = businessId ? { businessId: new mongoose.Types.ObjectId(businessId) } : {};
  report.businessesScanned = await Business.countDocuments(businessId ? { _id: productFilter.businessId } : {});
  const locationCache = new Map();
  let processed = 0;
  const cursor = Product.collection.find(productFilter).sort({ _id: 1 }).batchSize(100);

  while (await cursor.hasNext()) {
    if (limit !== null && processed >= limit) break;
    const product = await cursor.next();
    processed += 1;
    report.productsScanned += 1;
    if (!product.businessId || !mongoose.Types.ObjectId.isValid(product.businessId)) {
      issue(report, 'conflicts', { productId: idString(product._id), code: 'PRODUCT_BUSINESS_INVALID' });
      continue;
    }
    const businessKey = idString(product.businessId);

    if (!locationCache.has(businessKey)) {
      const locations = await BusinessLocation.collection.find({ businessId: product.businessId, active: true }).sort({ primary: -1, createdAt: 1, _id: 1 }).toArray();
      locationCache.set(businessKey, chooseMigrationLocation(locations));
    }
    const locationDecision = locationCache.get(businessKey);
    const positions = await InventoryPosition.collection.find({ businessId: product.businessId, productId: product._id }).toArray();

    await migrateItem({ item: buildItem(product), location: locationDecision.location, locationSource: locationDecision.reason || locationDecision.source, positions, report, dryRun });
    for (const variant of product.variants || []) {
      report.variantsScanned += 1;
      await migrateItem({ item: buildItem(product, variant), location: locationDecision.location, locationSource: locationDecision.reason || locationDecision.source, positions, report, dryRun });
    }
    if (processed % 100 === 0) logger.info(`Location inventory migration scanned ${processed} products`);
  }

  report.conflicts += report.malformedValues;
  report.finishedAt = new Date().toISOString();
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connectDatabase();
  try {
    const report = await runBackfill(args);
    console.log(JSON.stringify(report, null, 2));
    if (report.conflicts > 0 || report.missingLocations > 0) process.exitCode = 2;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Location inventory migration failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, createReport, buildItem, runBackfill };
