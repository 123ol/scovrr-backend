function normalizePhone(value) {
  if (value === null || value === undefined) return null;
  let compact = String(value).trim().replace(/[\s().-]/g, '');
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  if (/^0\d{10}$/.test(compact)) compact = `+234${compact.slice(1)}`;
  if (/^234\d{10}$/.test(compact)) compact = `+${compact}`;
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
  return compact;
}

module.exports = { normalizePhone };
