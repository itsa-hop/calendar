// Nevada state holidays observed by NSHE schools (UNLV, CSN, UNR, …), calculated
// for any year, so nothing needs updating each year.
// Fixed-date holidays that land on a weekend are observed on the nearest weekday
// (Saturday -> Friday, Sunday -> Monday), per NRS 236.015.

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// nth weekday of a month (weekday: 0 = Sun … 6 = Sat; n = 1..5, or -1 for last)
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(year, month, 1);
    return new Date(year, month, 1 + ((weekday - first.getDay() + 7) % 7) + (n - 1) * 7);
  }
  const last = new Date(year, month + 1, 0);
  return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
}

function observed(year, month, day) {
  const d = new Date(year, month, day);
  const dow = d.getDay();
  if (dow === 6) return { date: new Date(year, month, day - 1), shifted: true };
  if (dow === 0) return { date: new Date(year, month, day + 1), shifted: true };
  return { date: d, shifted: false };
}

function holidaysOf(year) {
  const list = [];
  const fixed = (month, day, name) => {
    const o = observed(year, month, day);
    list.push({ date: o.date, name: o.shifted ? `${name} (observed)` : name });
  };
  const floating = (date, name) => list.push({ date, name });

  fixed(0, 1, "New Year's Day");
  floating(nthWeekday(year, 0, 1, 3), "Martin Luther King Jr. Day");
  floating(nthWeekday(year, 1, 1, 3), "Presidents' Day");
  floating(nthWeekday(year, 4, 1, -1), "Memorial Day");
  fixed(5, 19, "Juneteenth");
  fixed(6, 4, "Independence Day");
  floating(nthWeekday(year, 8, 1, 1), "Labor Day");
  floating(nthWeekday(year, 9, 5, -1), "Nevada Day");
  fixed(10, 11, "Veterans Day");
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  floating(thanksgiving, "Thanksgiving Day");
  floating(new Date(year, 10, thanksgiving.getDate() + 1), "Family Day");
  fixed(11, 25, "Christmas Day");
  return list;
}

const cache = new Map(); // year -> Map(dateKey -> name)

// Holidays whose observed date falls in `year`. Includes next year's New Year's Day
// when it's observed on Dec 31.
function holidaysForYear(year) {
  if (!cache.has(year)) {
    const map = new Map();
    for (const h of [...holidaysOf(year), ...holidaysOf(year + 1)]) {
      if (h.date.getFullYear() === year) map.set(key(h.date), h.name);
    }
    cache.set(year, map);
  }
  return cache.get(year);
}

// Holiday name for a "YYYY-MM-DD" key, or undefined.
export function holidayOn(dateKey) {
  return holidaysForYear(Number(dateKey.slice(0, 4))).get(dateKey);
}
