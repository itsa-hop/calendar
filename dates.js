// Date helpers. Dates are handled as local "YYYY-MM-DD" keys throughout the app,
// so an event never shifts days when you travel across time zones.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const pad = (n) => String(n).padStart(2, "0");
export const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const keyOfDate = (dt) => keyOf(dt.getFullYear(), dt.getMonth(), dt.getDate());
export const todayKey = () => keyOfDate(new Date());
export const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (key, n) => { const d = parseKey(key); d.setDate(d.getDate() + n); return keyOfDate(d); };
// Inclusive length in days of start..end ("Oct 12 – 16" is 5).
export const spanLength = (start, end) => Math.round((parseKey(end) - parseKey(start)) / 86400000) + 1;
export const daysBetween = (a, b) => spanLength(a, b) - 1;
// Sunday that starts the week containing `key`.
export const weekStartOf = (key) => addDays(key, -parseKey(key).getDay());

// ISO 8601 week number (weeks run Monday–Sunday; week 1 contains the year's first Thursday).
export function isoWeek(key) {
  const d = parseKey(key);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3); // Thursday of this week
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

export const shortMonth = (m) => MONTHS[m].slice(0, 3);
export const formatShort = (key) => { const d = parseKey(key); return `${shortMonth(d.getMonth())} ${d.getDate()}`; };
export const formatLong = (key) => { const d = parseKey(key); return `${formatShort(key)}, ${d.getFullYear()}`; };
export const formatRange = (start, end) => {
  const a = parseKey(start), b = parseKey(end);
  const right = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? b.getDate() : `${shortMonth(b.getMonth())} ${b.getDate()}`;
  return `${formatShort(start)} – ${right}`;
};
