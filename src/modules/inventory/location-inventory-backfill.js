const LEGACY_INVENTORY_FIELDS = ['stockQuantity', 'reservedQuantity', 'availableQuantity'];

function asNonNegativeInteger(value) {
  if (value === undefined || value === null) return 0;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function readLegacyInventory(source = {}) {
  const values = {};
  const malformed = [];

  for (const field of LEGACY_INVENTORY_FIELDS) {
    const value = asNonNegativeInteger(source[field]);
    if (value === null) malformed.push({ field, value: source[field] });
    values[field] = value;
  }

  if (malformed.length > 0) return { valid: false, values, malformed, conflicts: [] };

  const conflicts = [];
  if (values.reservedQuantity > values.stockQuantity) conflicts.push('reserved_quantity_exceeds_stock');
  if (values.availableQuantity > values.stockQuantity) conflicts.push('available_quantity_exceeds_stock');
  if (values.stockQuantity - values.reservedQuantity !== values.availableQuantity) conflicts.push('stock_reserved_available_invariant_failed');

  return { valid: conflicts.length === 0, values, malformed: [], conflicts };
}

function chooseMigrationLocation(locations = []) {
  const active = locations.filter((location) => location.active !== false);
  const primary = active.find((location) => location.primary === true);
  if (primary) return { location: primary, source: 'primary' };
  if (active.length === 1) return { location: active[0], source: 'sole_active_default' };
  return {
    location: null,
    source: null,
    reason: active.length === 0 ? 'NO_ACTIVE_LOCATION' : 'MULTIPLE_ACTIVE_LOCATIONS_WITHOUT_PRIMARY'
  };
}

function sameInventoryValues(left, right) {
  return left.quantityOnHand === right.stockQuantity
    && left.quantityReserved === right.reservedQuantity
    && left.quantityAvailable === right.availableQuantity;
}

function positionValues(position) {
  return {
    quantityOnHand: position.quantityOnHand,
    quantityReserved: position.quantityReserved,
    quantityAvailable: position.quantityAvailable
  };
}

function sumPositionValues(positions) {
  return positions.reduce((sum, position) => ({
    quantityOnHand: sum.quantityOnHand + (position.quantityOnHand || 0),
    quantityReserved: sum.quantityReserved + (position.quantityReserved || 0),
    quantityAvailable: sum.quantityAvailable + (position.quantityAvailable || 0)
  }), { quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0 });
}

module.exports = {
  LEGACY_INVENTORY_FIELDS,
  readLegacyInventory,
  chooseMigrationLocation,
  sameInventoryValues,
  positionValues,
  sumPositionValues
};
