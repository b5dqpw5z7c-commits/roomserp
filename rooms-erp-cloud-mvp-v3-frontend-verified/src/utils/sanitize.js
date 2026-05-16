export function str(value, max = 500) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (!v) return null;
  return v.slice(0, max);
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function dateOnly(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date().toISOString().slice(0, 10);
  return text;
}

export function json(value, fallback = {}) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}
