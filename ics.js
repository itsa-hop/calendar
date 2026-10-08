// Export events as an .ics file that Google Calendar, Apple Calendar and Outlook
// can import. Events are all-day (the calendar has no separate times); repeating
// events keep their rule, and skipped occurrences are listed as exceptions.
import { addDays, pad } from "./dates.js";

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const compact = (key) => key.replaceAll("-", "");

// Text values escape \ ; , and newlines (RFC 5545 §3.3.11).
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 characters are folded onto continuation lines that start with a space.
function fold(line) {
  if (line.length <= 74) return line;
  const parts = [line.slice(0, 74)];
  for (let i = 74; i < line.length; i += 73) parts.push(" " + line.slice(i, i + 73));
  return parts.join("\r\n");
}

function stamp(date = new Date()) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export function buildICS(events, categories) {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const now = stamp();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//My Calendar//Planner//EN", "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:My Calendar"];

  for (const ev of events) {
    if (!ev.date) continue; // Someday items have no date to put on a calendar
    const end = ev.endDate && ev.endDate > ev.date ? ev.endDate : ev.date;
    lines.push("BEGIN:VEVENT",
      `UID:${ev.id}@my-calendar`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${compact(ev.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(end, 1))}`, // all-day end dates are exclusive
      `SUMMARY:${esc(ev.title)}`);
    if (catName.has(ev.category)) lines.push(`CATEGORIES:${esc(catName.get(ev.category))}`);
    if (ev.repeat) {
      const r = ev.repeat;
      let rule = `RRULE:FREQ=${r.freq.toUpperCase()};INTERVAL=${r.interval || 1}`;
      if (r.freq === "weekly" && r.days?.length) rule += `;BYDAY=${r.days.map((d) => BYDAY[d]).join(",")}`;
      if (r.until) rule += `;UNTIL=${compact(r.until)}`;
      lines.push(rule);
      if (ev.exceptions?.length) lines.push(`EXDATE;VALUE=DATE:${ev.exceptions.map(compact).join(",")}`);
    }
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadICS(events, categories, filename = "my-calendar.ics") {
  const blob = new Blob([buildICS(events, categories)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
