const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a date-only string ("2026-07-29") without going through Date.
 *
 * `new Date("2026-07-29")` parses as UTC midnight, and `toLocaleDateString`
 * then renders it in the local timezone — so a browser west of UTC shows the
 * previous day while the server shows the right one. That mismatch makes React
 * discard the server HTML on hydration, and a failed hydration takes every
 * event handler on the page with it.
 */
export function formatVisitDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/**
 * Format a timestamp for display. Timezone-dependent by nature, so this must
 * only ever run on the client — call it from an effect or behind a mounted
 * check, never during the server render.
 */
export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return `${formatVisitDate(date.toISOString())}, ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
