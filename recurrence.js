// Repeating events. A repeating event is stored once, with a rule:
//   repeat: { freq: "daily" | "weekly" | "monthly" | "yearly",
//             interval: 1..99,            // every N days/weeks/months/years
//             days: [0..6],               // weekly only: which weekdays (0 = Sun)
//             until: "YYYY-MM-DD" | null } // last possible date, or forever
//   exceptions: ["YYYY-MM-DD", …]          // occurrences that were deleted or moved
// The calendar only works out the occurrences for the dates it's showing, so a
// "forever" event costs nothing extra.
import { addDays, daysBetween, formatShort, parseKey, keyOfDate, WEEKDAYS, MONTHS } from "./dates.js";

export const FREQS = ["daily", "weekly", "monthly", "yearly"];
const SAFETY_LIMIT = 4000; // max loop steps per event per render

export function normalizeRepeat(rule, startKey) {
  if (!rule || !FREQS.includes(rule.freq)) return null;
  const interval = Math.min(99, Math.max(1, Math.floor(Number(rule.interval) || 1)));
  const out = { freq: rule.freq, interval };
  if (rule.freq === "weekly") {
    const days = [...new Set((rule.days ?? []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    out.days = days.length ? days : [parseKey(startKey).getDay()];
  }
  out.until = rule.until && rule.until >= startKey ? rule.until : null;
  return out;
}

// Start dates of an event's occurrences that overlap from..to (inclusive), sorted.
export function occurrenceStarts(ev, from, to) {
  if (!ev.date) return []; // Someday items have no date
  const extra = ev.endDate && ev.endDate > ev.date ? daysBetween(ev.date, ev.endDate) : 0;
  const rule = ev.repeat;
  if (!rule) return ev.date <= to && addDays(ev.date, extra) >= from ? [ev.date] : [];

  const lo = addDays(from, -extra); // earliest start that still reaches `from`
  const hi = rule.until && rule.until < to ? rule.until : to;
  if (hi < ev.date || lo > hi) return [];

  const skip = new Set(ev.exceptions ?? []);
  const n = Math.max(1, rule.interval || 1);
  const start = parseKey(ev.date);
  const out = [];
  const push = (k) => { if (k >= ev.date && k >= lo && k <= hi && !skip.has(k)) out.push(k); };

  if (rule.freq === "daily") {
    let i = Math.max(0, Math.floor(daysBetween(ev.date, lo) / n));
    for (let c = 0; c < SAFETY_LIMIT; c++, i++) {
      const k = addDays(ev.date, i * n);
      if (k > hi) break;
      push(k);
    }
  } else if (rule.freq === "weekly") {
    const days = rule.days?.length ? rule.days : [start.getDay()];
    const week0 = addDays(ev.date, -start.getDay());
    let w = Math.max(0, Math.floor(daysBetween(week0, lo) / 7 / n) - 1);
    for (let c = 0; c < SAFETY_LIMIT; c++, w++) {
      const weekStart = addDays(week0, w * 7 * n);
      if (weekStart > hi) break;
      for (const d of days) push(addDays(weekStart, d));
    }
  } else if (rule.freq === "monthly") {
    // Same day of the month; months without that day (e.g. the 31st) are skipped.
    const day = start.getDate();
    const l = parseKey(lo);
    const monthsAway = (l.getFullYear() - start.getFullYear()) * 12 + l.getMonth() - start.getMonth();
    let i = Math.max(0, Math.floor(monthsAway / n) - 1);
    for (let c = 0; c < SAFETY_LIMIT; c++, i++) {
      const y = start.getFullYear(), m = start.getMonth() + i * n;
      if (keyOfDate(new Date(y, m, 1)) > hi) break;
      if (new Date(y, m + 1, 0).getDate() >= day) push(keyOfDate(new Date(y, m, day)));
    }
  } else if (rule.freq === "yearly") {
    // Same date each year; Feb 29 only lands in leap years.
    const month = start.getMonth(), day = start.getDate();
    let i = Math.max(0, Math.floor((parseKey(lo).getFullYear() - start.getFullYear()) / n) - 1);
    for (let c = 0; c < SAFETY_LIMIT; c++, i++) {
      const y = start.getFullYear() + i * n;
      if (keyOfDate(new Date(y, 0, 1)) > hi) break;
      const d = new Date(y, month, day);
      if (d.getMonth() === month) push(keyOfDate(d));
    }
  }
  return out;
}

// First occurrence on or after `fromKey` (looking up to 5 years ahead), or null.
export function nextOccurrence(ev, fromKey) {
  if (!ev.date) return null;
  if (!ev.repeat) return ev.date >= fromKey ? ev.date : null;
  return occurrenceStarts(ev, fromKey, addDays(fromKey, 5 * 366))[0] ?? null;
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// "Weekly on Mon, Wed", "Every 2 weeks on Fri until Dec 12, 2026", "Monthly on the 14th"…
export function describeRepeat(rule, startKey) {
  if (!rule) return "";
  const n = rule.interval || 1;
  const d = parseKey(startKey);
  let text;
  if (rule.freq === "daily") {
    text = n === 1 ? "Every day" : `Every ${n} days`;
  } else if (rule.freq === "weekly") {
    const days = rule.days?.length ? rule.days : [d.getDay()];
    if (days.join() === "1,2,3,4,5" && n === 1) text = "Every weekday (Mon–Fri)";
    else {
      const names = days.join() === "1,2,3,4,5" ? "weekdays" : days.map((x) => WEEKDAYS[x]).join(", ");
      text = `${n === 1 ? "Weekly" : `Every ${n} weeks`} on ${names}`;
    }
  } else if (rule.freq === "monthly") {
    text = `${n === 1 ? "Monthly" : `Every ${n} months`} on the ${ordinal(d.getDate())}`;
  } else {
    text = `${n === 1 ? "Yearly" : `Every ${n} years`} on ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  }
  if (rule.until) text += ` until ${formatShort(rule.until)}, ${parseKey(rule.until).getFullYear()}`;
  return text;
}
