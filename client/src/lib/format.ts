function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// local time, e.g. 2026-09-08 14:03
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(iso: string): string {
  // A date-only string is already a local 'YYYY-MM-DD' key; new Date() would
  // parse it as UTC midnight and shift the day for western timezones.
  if (DATE_KEY_RE.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
