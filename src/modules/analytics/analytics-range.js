const { AppError } = require('../../common/errors/AppError');

function startOfUtcDay(date = new Date()) { const value = new Date(date); value.setUTCHours(0, 0, 0, 0); return value; }
function parseRange(query = {}) {
  const now = new Date();
  let from;
  let to = now;
  if (query.from || query.to) {
    from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    to = query.to ? new Date(query.to) : now;
  } else if (query.range === 'today') from = startOfUtcDay(now);
  else if (query.range === '7d') from = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  else from = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) throw new AppError(400, 'INVALID_ANALYTICS_RANGE', 'The analytics date range is invalid');
  if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60_000) throw new AppError(400, 'ANALYTICS_RANGE_TOO_LARGE', 'Analytics ranges cannot exceed one year');
  const duration = to.getTime() - from.getTime();
  return { from, to, previousFrom: new Date(from.getTime() - duration), previousTo: from, label: query.range || 'custom' };
}
function dateMatch(range, field = 'createdAt') { return { [field]: { $gte: range.from, $lt: range.to } }; }
function dateKey(date) { return new Date(date).toISOString().slice(0, 10); }
module.exports = { parseRange, dateMatch, dateKey, startOfUtcDay };
