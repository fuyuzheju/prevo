// Local-calendar date helpers shared by server and client. All dates are
// interpreted in the process's local timezone (the server settles cycles on
// local calendar days, clients display local dates).

export function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

// 'YYYY-MM-DD' of the local calendar day
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Local midnight of the given 'YYYY-MM-DD' key. Rolls invalid parts over
// like Date does; callers validate by round-tripping localDateKey.
export function parseLocalDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? Number.NaN, (month ?? 1) - 1, day ?? 1);
}

// Local midnight of `date`, plus `days` (can be negative)
export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Is the 'YYYY-MM-DD' key later than today's local calendar day? Keys sort
// lexicographically, so a plain string comparison is a date comparison.
export function isFutureDateKey(key: string, now: Date = new Date()): boolean {
  return key > localDateKey(now);
}

// Are two dates on the same local calendar day?
export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
