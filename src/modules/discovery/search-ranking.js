function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function fieldScore(query, value, weight) {
  const term = normalized(query);
  const text = normalized(value);
  if (!term || !text) return 0;
  if (text === term) return weight;
  if (text.startsWith(term)) return weight * 0.8;
  if (text.includes(term)) return weight * 0.5;
  return 0;
}

function searchScore(query, fields = []) {
  return fields.reduce((score, field) => score + fieldScore(query, field.value, field.weight), 0);
}

function rankSearchResults(records, query, fieldsForRecord, { businessOrder, getBusinessId = (record) => record.businessId } = {}) {
  if (!String(query || '').trim()) return records;
  const locationOrder = Array.isArray(businessOrder) && businessOrder.length > 0
    ? new Map(businessOrder.map((businessId, index) => [idString(businessId), index]))
    : null;
  return [...records].sort((left, right) => {
    const scoreDifference = searchScore(query, fieldsForRecord(right)) - searchScore(query, fieldsForRecord(left));
    if (scoreDifference) return scoreDifference;
    if (locationOrder) {
      const leftLocation = locationOrder.get(idString(getBusinessId(left))) ?? Number.MAX_SAFE_INTEGER;
      const rightLocation = locationOrder.get(idString(getBusinessId(right))) ?? Number.MAX_SAFE_INTEGER;
      if (leftLocation !== rightLocation) return leftLocation - rightLocation;
    }
    const ratingDifference = Number(right.ratingAverage || 0) - Number(left.ratingAverage || 0);
    if (ratingDifference) return ratingDifference;
    const countDifference = Number(right.ratingCount || 0) - Number(left.ratingCount || 0);
    if (countDifference) return countDifference;
    return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
  });
}

function idString(value) {
  return value?._id?.toString?.() || value?.toString?.() || null;
}

function rankByBusinessOrder(records, businessOrder, getBusinessId = (record) => record.businessId) {
  if (!Array.isArray(businessOrder) || businessOrder.length === 0) return records;
  const order = new Map(businessOrder.map((businessId, index) => [idString(businessId), index]));
  return [...records].sort((left, right) => (order.get(idString(getBusinessId(left))) ?? Number.MAX_SAFE_INTEGER) - (order.get(idString(getBusinessId(right))) ?? Number.MAX_SAFE_INTEGER));
}

module.exports = { normalized, fieldScore, searchScore, rankSearchResults, rankByBusinessOrder };
