// ui/lib/format.js — date/number formatting helpers.
// SQLite stores datetimes as UTC "YYYY-MM-DD HH:MM:SS"; parseUtc normalizes to a Date.

export function parseUtc(s) {
  if (!s) return null;
  // Add the 'T' and 'Z' so it's parsed as UTC, not local.
  const iso = s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(s) {
  const d = parseUtc(s);
  return d ? d.toLocaleString() : '—';
}

export function relativeTime(s) {
  const d = parseUtc(s);
  if (!d) return '—';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function pct(part, whole) {
  if (!whole) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}
