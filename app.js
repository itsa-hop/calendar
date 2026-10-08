import { initStore, isConfigured } from "./store.js";
import { holidayOn } from "./holidays.js";
import {
  MONTHS, WEEKDAYS, keyOf, keyOfDate, todayKey, parseKey, addDays, spanLength, daysBetween,
  weekStartOf, shortMonth, formatShort, formatLong, formatRange, isoWeek,
} from "./dates.js";
import { occurrenceStarts, nextOccurrence, normalizeRepeat, describeRepeat } from "./recurrence.js";
import { downloadICS } from "./ics.js";

// ---------- Settings & state ----------

const PALETTE_SIZE = 6; // event colors: --ev-0 … --ev-5 in styles.css
const CAT_COLORS = 8;   // category colors: --cat-0 … --cat-7
const VIEWS = ["month", "week", "year", "agenda"];
const YEAR_MODE_IDS = ["calendar", "rolling", "four"];
const VIEW_KEY = "calendar.view";
const YEAR_MODE_KEY = "calendar.yearMode";
const HOLIDAYS_KEY = "calendar.showHolidays";
const HIDDEN_CATS_KEY = "calendar.hiddenCategories";
const HIDE_REPEATING_KEY = "calendar.hideRepeating";
const COMPACT_KEY = "calendar.compact";
const WEEK_NUMBERS_KEY = "calendar.weekNumbers";
const THEME_KEY = "calendar.theme"; // also read by the inline script in index.html
const THEMES = ["auto", "light", "dark"];
const AGENDA_STEP_DAYS = 14;

// You start with no categories and make your own (⋯ → Categories…, or
// "+ New category…" in the event form).

const now = new Date();
const state = {
  view: loadPref(VIEW_KEY, VIEWS, "month"),
  yearMode: loadPref(YEAR_MODE_KEY, YEAR_MODE_IDS, "calendar"),
  showHolidays: loadPref(HOLIDAYS_KEY, ["0", "1"], "1") === "1",
  hiddenCats: loadHiddenCats(), // category ids (or "none") you've filtered out on this device
  hideRepeating: loadPref(HIDE_REPEATING_KEY, ["0", "1"], "0") === "1", // hide all repeating events on this device
  compact: loadPref(COMPACT_KEY, ["0", "1"], "0") === "1",           // compact view on this device
  weekNumbers: loadPref(WEEK_NUMBERS_KEY, ["0", "1"], "1") === "1",  // show ISO week numbers
  printMode: false,                                                   // print preview is open
  somedayOpen: false,                                                 // the Someday list is open
  year: now.getFullYear(),      // month / year views
  month: now.getMonth(),
  focus: todayKey(),            // week / agenda views
  agendaDays: AGENDA_STEP_DAYS,
  events: [],                   // as stored (a repeating event is one entry)
  byDate: new Map(),            // "YYYY-MM-DD" -> [{ ev, span, time, color }] for the dates on screen
  dayOrders: {},                // "YYYY-MM-DD" -> [occurrence ids] for days reordered by hand
  categories: [],
  selected: null,               // date key shown in the day panel
  editing: null,                // { id, draft } while an event is being edited in the panel
  store: null,
};

function loadPref(key, allowed, fallback) {
  try { const v = localStorage.getItem(key); return allowed.includes(v) ? v : fallback; }
  catch { return fallback; }
}
function savePref(key, value) { try { localStorage.setItem(key, value); } catch {} }
function loadHiddenCats() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_CATS_KEY)) ?? []); }
  catch { return new Set(); }
}

const $ = (id) => document.getElementById(id);

// Tiny DOM builder. Strings become text nodes, so user content is never parsed as HTML.
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const icon = (d) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
};
const ICON_EDIT = "M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4";
const ICON_DELETE = "M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13";
const ICON_GRIP = "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01";
const ICON_CHECK = "M5 12.5l4.5 4.5L19 7";
const ICON_CLEAR = "M6 6l12 12M18 6L6 18";
const ICON_CALENDAR = "M5 6h14v14H5zM5 10h14M9 3v4M15 3v4";

// "Weekly on Mon" -> "weekly on Mon" (for use mid-sentence).
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const holidayFor = (key) => (state.showHolidays ? holidayOn(key) : undefined);
const isGridView = () => state.view === "month" || state.view === "week";
const wideScreen = () => matchMedia("(min-width: 720px)").matches;

// ---------- Event titles ----------

// Recognizes a time at the start of a title: "3pm", "3:30 p.m.", "10am", "14:30".
// Returns { minutes, label, rest } or null.
function parseTime(title) {
  let m = title.match(/^\s*(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m\.?(?=$|[\s,\-–—:])/i);
  let hours, mins;
  if (m) {
    hours = Number(m[1]);
    mins = Number(m[2] ?? 0);
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
  } else {
    m = title.match(/^\s*([01]?\d|2[0-3]):([0-5]\d)(?=$|[\s,\-–—])/);
    if (!m) return null;
    hours = Number(m[1]);
    mins = Number(m[2]);
  }
  const rest = title.slice(m[0].length).replace(/^[\s,\-–—:]+/, "");
  return { minutes: hours * 60 + mins, label: m[0].trim(), rest: rest || title.trim() };
}

const displayTitle = (item) => (item.time ? item.time.rest : item.ev.title);

// ---------- Categories ----------

const catOf = (ev) => (ev.category ? state.categories.find((c) => c.id === ev.category) ?? null : null);
const catStyle = (c) => `--k: var(--cat-${c.color % CAT_COLORS}); --k-rgb: var(--cat-${c.color % CAT_COLORS}-rgb)`;

// The small colored tag shown in front of a title ("SCH"); `full` shows the name instead.
function catTag(ev, full = false) {
  const c = catOf(ev);
  if (!c) return null;
  return h("span", { class: `cat-tag${full ? " full" : ""}`, style: catStyle(c), title: c.name },
    full ? c.name : (c.short || c.name.slice(0, 3)));
}

const passesCategoryFilter = (ev) => {
  const c = catOf(ev);
  return !state.hiddenCats.has(c ? c.id : "none");
};

// What the views show: your category filter, plus the "Repeating" toggle.
function passesFilter(ev) {
  if (state.hideRepeating && ev.repeat) return false;
  return passesCategoryFilter(ev);
}

// Repeating events on `key` that are hidden by the Repeating toggle (for the day panel's note).
function hiddenRepeatingOn(key) {
  if (!state.hideRepeating) return 0;
  return state.events.filter((ev) => ev.repeat && passesCategoryFilter(ev)
    && occurrenceStarts(ev, key, key).length > 0).length;
}

// ---------- Occurrences ----------
// What the views draw are occurrences: a one-off event as-is, or one date of a
// repeating event. They look like events (title, date, endDate…) plus:
//   id      unique per occurrence ("<event id>@<date>" for repeats)
//   sid     the stored event's id
//   series  the stored repeating event (null for one-offs)
//   done    whether this occurrence is done

const MAX_SPAN_DAYS = 366;
const isSpan = (ev) => !!ev.endDate && ev.endDate > ev.date;

function makeOcc(ev, start) {
  const extra = isSpan(ev) ? daysBetween(ev.date, ev.endDate) : 0;
  const repeating = !!ev.repeat;
  return {
    ...ev,
    id: repeating ? `${ev.id}@${start}` : ev.id,
    sid: ev.id,
    series: repeating ? ev : null,
    date: start,
    endDate: extra ? addDays(start, extra) : undefined,
    done: repeating ? (ev.doneDates ?? []).includes(start) : !!ev.done,
  };
}

function daysOf(ev) {
  if (!isSpan(ev)) return [ev.date];
  const out = [];
  for (let k = ev.date, i = 0; k <= ev.endDate && i < MAX_SPAN_DAYS; k = addDays(k, 1), i++) out.push(k);
  return out;
}

// A multi-day event keeps the same color on every day it covers.
function stableColor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % PALETTE_SIZE;
}

// Automatic order: multi-day events first, then timed events by time, then the
// rest alphabetically, with done items after the rest. If you've reordered the day
// by hand, your order wins and events added since go at the end. One-day events
// rotate through the colors not already taken by that day's multi-day events.
function sortDay(events, dayKey) {
  const items = events.map((ev) => {
    const span = isSpan(ev)
      ? { pos: dayKey === ev.date ? "start" : dayKey === ev.endDate ? "end" : "mid",
          index: spanLength(ev.date, dayKey), length: spanLength(ev.date, ev.endDate) }
      : null;
    return { ev, span, time: parseTime(ev.title) };
  });
  items.sort((a, b) => {
    if (a.span && b.span) return a.ev.date.localeCompare(b.ev.date) || a.ev.id.localeCompare(b.ev.id);
    if (a.span) return -1;
    if (b.span) return 1;
    if (a.ev.done !== b.ev.done) return a.ev.done ? 1 : -1;
    if (a.time && b.time) return a.time.minutes - b.time.minutes || a.ev.createdAt - b.ev.createdAt;
    if (a.time) return -1;
    if (b.time) return 1;
    return a.ev.title.localeCompare(b.ev.title, undefined, { sensitivity: "base" })
      || a.ev.createdAt - b.ev.createdAt;
  });

  const manual = state.dayOrders[dayKey];
  if (manual?.length) {
    const rank = new Map(manual.map((id, i) => [id, i]));
    const known = items.filter((it) => rank.has(it.ev.id)).sort((a, b) => rank.get(a.ev.id) - rank.get(b.ev.id));
    const added = items.filter((it) => !rank.has(it.ev.id));
    items.splice(0, items.length, ...known, ...added);
  }

  const taken = new Set();
  for (const it of items) if (it.span) { it.color = stableColor(it.ev.id); taken.add(it.color); }
  const free = [...Array(PALETTE_SIZE).keys()].filter((c) => !taken.has(c));
  const palette = free.length ? free : [...Array(PALETTE_SIZE).keys()];
  let next = 0;
  for (const it of items) if (!it.span) it.color = palette[next++ % palette.length];
  return items;
}

// Builds state.byDate for from..to (inclusive), applying the category filter.
function indexEvents(from, to) {
  const groups = new Map();
  for (const ev of state.events) {
    if (!passesFilter(ev)) continue;
    for (const start of occurrenceStarts(ev, from, to)) {
      const occ = makeOcc(ev, start);
      for (const k of daysOf(occ)) {
        if (k < from || k > to) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(occ);
      }
    }
  }
  for (const [k, list] of groups) groups.set(k, sortDay(list, k));
  state.byDate = groups;
}

// The dates the current view needs (plus the open day, if any).
function monthGrid(y = state.year, m = state.month) {
  const startOffset = new Date(y, m, 1).getDay();
  const weeks = Math.ceil((startOffset + new Date(y, m + 1, 0).getDate()) / 7);
  return { start: keyOfDate(new Date(y, m, 1 - startOffset)), weeks };
}

function viewRange() {
  let from, to;
  if (state.view === "month") {
    const g = monthGrid();
    from = g.start;
    to = addDays(g.start, g.weeks * 7 - 1);
  } else if (state.view === "week") {
    from = weekStartOf(state.focus);
    to = addDays(from, 6);
  } else if (state.view === "agenda") {
    from = state.focus;
    to = addDays(from, state.agendaDays - 1);
  } else {
    const months = yearViewMonths();
    const a = months[0], b = months[months.length - 1];
    from = keyOf(a.y, a.m, 1);
    to = keyOf(b.y, b.m, new Date(b.y, b.m + 1, 0).getDate());
  }
  if (state.selected) {
    if (state.selected < from) from = state.selected;
    if (state.selected > to) to = state.selected;
  }
  return { from, to };
}

const evStyle = (n) => `--c: var(--ev-${n}); --c-rgb: var(--ev-${n}-rgb)`;

// ---------- Rendering ----------

function rangeTitle(from, to) {
  const a = parseKey(from), b = parseKey(to);
  return a.getFullYear() === b.getFullYear()
    ? `${formatRange(from, to)}, ${b.getFullYear()}`
    : `${formatLong(from)} – ${formatLong(to)}`;
}

function render() {
  const range = viewRange();
  indexEvents(range.from, range.to);

  const titles = {
    month: () => `${MONTHS[state.month]} ${state.year}`,
    week: () => rangeTitle(weekStartOf(state.focus), addDays(weekStartOf(state.focus), 6))
      + (state.weekNumbers ? ` · Wk ${isoWeek(addDays(weekStartOf(state.focus), 1))}` : ""),
    agenda: () => rangeTitle(state.focus, addDays(state.focus, state.agendaDays - 1)),
    year: yearViewTitle,
  };
  $("title").textContent = titles[state.view]();
  $("print-title").textContent = $("title").textContent;
  document.body.classList.toggle("grid-view", isGridView());
  document.body.classList.toggle("compact", state.compact);
  document.documentElement.classList.toggle("print-mode", state.printMode);
  for (const v of VIEWS) $(`view-${v}`).setAttribute("aria-selected", String(state.view === v));
  const unit = { month: "month", week: "week", agenda: "week", year: state.yearMode === "calendar" ? "year" : "month" }[state.view];
  $("prev").setAttribute("aria-label", `Previous ${unit}`);
  $("next").setAttribute("aria-label", `Next ${unit}`);

  const body = { month: renderMonth, week: renderWeekView, year: renderYear, agenda: renderAgenda }[state.view]();
  $("calendar").replaceChildren(body, renderLegend());
  if (state.selected) renderPanel();
  renderSomedayButton();
  if (state.somedayOpen) renderSomeday();
}

function renderLegend() {
  const anyHidden = state.hiddenCats.size > 0 || state.hideRepeating;
  const chip = (id, label, name, c) => {
    const hidden = state.hiddenCats.has(id);
    return h("button", {
      type: "button",
      class: `filter-chip${hidden ? " off" : ""}`,
      style: c ? catStyle(c) : null,
      "aria-pressed": String(!hidden),
      title: `${hidden ? "Show" : "Hide"} ${name}`,
      onclick: () => toggleCategoryFilter(id),
    }, h("span", { class: "filter-dot", "aria-hidden": "true" }), label);
  };
  return h("div", { class: "legend" },
    h("div", { class: "legend-row" },
      h("span", { class: "legend-item" }, h("i", { class: "swatch one" }), "1 event"),
      h("span", { class: "legend-item" }, h("i", { class: "swatch many" }), "2+ events"),
      state.showHolidays && h("span", { class: "legend-item" }, h("i", { class: "swatch holiday" }), "School holiday"),
      h("label", { class: "legend-toggle" },
        h("input", { type: "checkbox", checked: state.showHolidays, onchange: (e) => setShowHolidays(e.target.checked) }),
        "Show Nevada school holidays")),
    h("div", { class: "filters", role: "group", "aria-label": "Show events" },
      h("span", { class: "filters-label" }, "Show:"),
      h("button", {
        type: "button",
        class: `filter-chip repeat-chip${state.hideRepeating ? " off" : ""}`,
        "aria-pressed": String(!state.hideRepeating),
        title: state.hideRepeating ? "Show repeating events" : "Hide repeating events",
        onclick: () => setHideRepeating(!state.hideRepeating),
      }, h("span", { class: "repeat-icon", "aria-hidden": "true" }, "↻"), "Repeating"),
      state.categories.map((c) => chip(c.id, c.name, c.name, c)),
      state.categories.length > 0 && chip("none", "No category", "events without a category", null),
      anyHidden && h("button", { type: "button", class: "link-btn inline", onclick: showEverything }, "Show all")));
}

// Shared pieces of an event's label: category tag, time, title, repeat mark.
function labelParts(it) {
  return [
    catTag(it.ev),
    it.time && h("b", {}, it.time.label, " "),
    h("span", { class: "label-title" }, displayTitle(it)),
    it.ev.series && h("span", { class: "rep", title: describeRepeat(it.ev.series.repeat, it.ev.series.date), "aria-label": "repeats" }, " ↻"),
  ];
}

function doneBtn(occ) {
  return h("button", {
    type: "button",
    class: `done-btn${occ.done ? " checked" : ""}`,
    "aria-pressed": String(occ.done),
    "aria-label": occ.done ? `Mark "${occ.title}" as not done` : `Mark "${occ.title}" as done`,
    title: occ.done ? "Done (tap to undo)" : "Mark done",
    onpointerdown: (e) => e.stopPropagation(), // don't start a drag
    onclick: (e) => { e.stopPropagation(); toggleDone(occ); },
  }, icon(ICON_CHECK));
}

// ---------- Month view ----------

// Multi-day events are drawn as one banner per week row, stacked in "lanes".
// Up to this many lanes are shown; any extra are folded into "+N more".
const MAX_LANES = 3;

function renderMonth() {
  const g = monthGrid();
  const head = h("div", { class: "weekdays", "aria-hidden": "true" },
    WEEKDAYS.map((w) => h("span", {}, h("span", { class: "long" }, w), h("span", { class: "short" }, w[0]))));
  const weeks = [];
  for (let w = 0; w < g.weeks; w++) weeks.push(renderWeekRow(addDays(g.start, w * 7), { month: state.month }));
  const grid = h("div", { class: "grid" }, weeks);
  attachGridGestures(grid);
  return h("div", { class: "month" }, head, grid);
}

// One week row: seven day cells plus the multi-day banners that cross it.
// opts.month: the month being shown (days outside it are dimmed), or -1.
// opts.full:  Week view, where each day lists all of its events.
function renderWeekRow(firstKey, opts) {
  const keys = Array.from({ length: 7 }, (_, i) => addDays(firstKey, i));
  const lastKey = keys[6];
  const maxLanes = opts.full || state.printMode ? 6 : MAX_LANES;
  const today = todayKey();

  // Multi-day events touching this week, clipped to the week.
  const spans = new Map();
  for (const k of keys) {
    for (const it of state.byDate.get(k) ?? []) if (it.span && !spans.has(it.ev.id)) spans.set(it.ev.id, it);
  }
  const segments = [...spans.values()].map((it) => {
    const from = it.ev.date > firstKey ? it.ev.date : firstKey;
    const to = it.ev.endDate < lastKey ? it.ev.endDate : lastKey;
    return { it, from, col: daysBetween(firstKey, from), cols: daysBetween(from, to) + 1,
      starts: from === it.ev.date, ends: to === it.ev.endDate };
  }).sort((a, b) => a.col - b.col || b.cols - a.cols || a.it.ev.id.localeCompare(b.it.ev.id));

  // Give each banner the first lane that's free from its start column.
  const laneEnds = [];
  const hidden = new Map(); // date key -> banners that didn't fit
  for (const s of segments) {
    let lane = laneEnds.findIndex((end) => end < s.col);
    if (lane === -1) lane = laneEnds.length;
    if (lane >= maxLanes) {
      s.lane = null;
      for (let c = s.col; c < s.col + s.cols; c++) hidden.set(keys[c], (hidden.get(keys[c]) ?? 0) + 1);
      continue;
    }
    laneEnds[lane] = s.col + s.cols - 1;
    s.lane = lane;
  }
  const lanes = laneEnds.length;

  // ISO week number of the row (counted from its Monday), shown in the left margin.
  const week = isoWeek(keys[1]);
  return h("div", { class: "week", style: `--lanes: ${lanes}` },
    state.weekNumbers && !opts.full && h("span", { class: "wk-num", title: `Week ${week}`, "aria-hidden": "true" }, week),
    keys.map((key) => renderDayCell(key, opts, today, lanes, hidden.get(key) ?? 0)),
    segments.filter((s) => s.lane != null).map(renderBar));
}

function renderDayCell(key, opts, today, lanes, hiddenSpans) {
  const dt = parseKey(key);
  const items = state.byDate.get(key) ?? [];
  const singles = items.filter((it) => !it.span);
  const n = items.length;
  const outside = opts.month >= 0 && dt.getMonth() !== opts.month;
  const holiday = holidayFor(key);

  const classes = ["day"];
  if (outside) classes.push("outside");
  if (key === today) classes.push("today");
  if (key === state.selected) classes.push("selected");
  if (n === 1) classes.push("has-one");
  if (n > 1) classes.push("has-many");
  if (holiday) classes.push("holiday");

  const label = `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`
    + (holiday ? `, ${holiday} (no school)` : "")
    + (n ? `, ${plural(n, "event")}` : "");
  const open = () => { if (!drag.suppressClick && !move.suppressClick) openDayFromGrid(key); };

  // How many one-day events fit in a cell: all of them in Week view and print,
  // 3 in compact view (smaller text), otherwise 2.
  const shown = opts.full || state.printMode ? singles : singles.slice(0, state.compact ? 3 : 2);
  const more = singles.length - shown.length + hiddenSpans;
  const chip = (it) => h("span", {
    class: `chip${it.ev.done ? " is-done" : ""}`, "data-id": it.ev.id, style: evStyle(it.color),
  }, opts.full && doneBtn(it.ev), labelParts(it));

  const content = [
    h("span", { class: "day-top" },
      opts.full && h("span", { class: "wd" }, WEEKDAYS[dt.getDay()]),
      h("span", { class: "num" }, dt.getDate()),
      holiday && h("span", { class: "holiday-name" }, holiday),
      n > 1 && h("span", { class: "count" }, n)),
    lanes > 0 && h("span", { class: "lane-space", "aria-hidden": "true" }),
    (shown.length > 0 || more > 0) && h("span", { class: "chips" },
      shown.map(chip),
      more > 0 && h("span", { class: "more" }, `+${more} more`)),
    !opts.full && singles.length > 0 && h("span", { class: "dots", "aria-hidden": "true" },
      singles.slice(0, 4).map((it) => h("i", { class: it.ev.done ? "is-done" : null, style: evStyle(it.color) })),
      singles.length > 4 && h("span", { class: "dots-more" }, "+")),
  ];

  // Week view cells hold buttons (✓), so they can't be <button>s themselves.
  if (opts.full) {
    return h("div", {
      class: classes.join(" "), role: "button", tabindex: "0", "aria-label": label, "data-key": key,
      onclick: open,
      onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); open(); } },
    }, content);
  }
  return h("button", { class: classes.join(" "), "aria-label": label, "data-key": key, onclick: open }, content);
}

// A multi-day event's banner for one week: the name is written once across its days.
function renderBar(s) {
  const { it } = s;
  return h("div", {
    class: `bar${s.starts ? " starts" : ""}${s.ends ? " ends" : ""}${it.ev.done ? " is-done" : ""}`,
    "data-id": it.ev.id,
    "data-start": s.from,
    "data-cols": s.cols,
    "aria-hidden": "true",
    title: `${it.ev.title} · ${formatRange(it.ev.date, it.ev.endDate)}`,
    style: `${evStyle(it.color)}; --col: ${s.col}; --span: ${s.cols}; --lane: ${s.lane}`,
    onclick: (e) => {
      if (drag.suppressClick || move.suppressClick) return;
      openDayFromGrid(keyAtBar(e.currentTarget, e.clientX));
    },
  },
    !s.starts && h("span", { class: "cont" }, "‹ "),
    labelParts(it));
}

function openDayFromGrid(key) {
  if (state.view === "month") {
    const d = parseKey(key);
    state.year = d.getFullYear();
    state.month = d.getMonth();
  }
  openDay(key);
}

// Which day of a banner is under horizontal position x.
function keyAtBar(bar, x) {
  const r = bar.getBoundingClientRect();
  const cols = Number(bar.dataset.cols);
  const i = Math.min(cols - 1, Math.max(0, Math.floor(((x - r.left) / r.width) * cols)));
  return addDays(bar.dataset.start, i);
}

// Day under a screen point, looking through banners.
function keyFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const bar = el?.closest?.(".bar[data-start]");
  if (bar) return keyAtBar(bar, x);
  return el?.closest?.(".day[data-key]")?.dataset.key ?? null;
}

// ---------- Week view ----------
// Computer: the week as seven tall columns showing every event.
// Phone: the seven days as rows.

function renderWeekView() {
  const start = weekStartOf(state.focus);
  if (wideScreen()) {
    const grid = h("div", { class: "grid week-full" }, renderWeekRow(start, { month: -1, full: true }));
    attachGridGestures(grid);
    return h("div", { class: "month week-view" }, grid);
  }
  const list = h("div", { class: "grid week-list" },
    Array.from({ length: 7 }, (_, i) => renderWeekListRow(addDays(start, i))));
  attachGridGestures(list);
  return h("div", { class: "week-view" }, list);
}

function renderWeekListRow(key) {
  const dt = parseKey(key);
  const items = state.byDate.get(key) ?? [];
  const holiday = holidayFor(key);
  const classes = ["day", "week-row"];
  if (key === todayKey()) classes.push("today");
  if (key === state.selected) classes.push("selected");
  if (items.length === 1) classes.push("has-one");
  if (items.length > 1) classes.push("has-many");
  if (holiday) classes.push("holiday");
  const open = () => { if (!drag.suppressClick && !move.suppressClick) openDay(key); };

  return h("div", {
    class: classes.join(" "), role: "button", tabindex: "0", "data-key": key,
    "aria-label": `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}${items.length ? `, ${plural(items.length, "event")}` : ""}`,
    onclick: open,
    onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); open(); } },
  },
    h("span", { class: "wr-head" },
      h("span", { class: "wd" }, WEEKDAYS[dt.getDay()]),
      h("span", { class: "num" }, dt.getDate()),
      holiday && h("span", { class: "wr-holiday" }, holiday)),
    h("span", { class: "chips wr-chips" },
      items.length
        ? items.map((it) => h("span", {
            class: `chip${it.ev.done ? " is-done" : ""}`, "data-id": it.ev.id, style: evStyle(it.color),
          }, doneBtn(it.ev), labelParts(it),
            it.span && h("span", { class: "chip-range" }, ` · ${formatRange(it.ev.date, it.ev.endDate)}`)))
        : h("span", { class: "wr-empty" }, "—")));
}

// ---------- Agenda view ----------
// Today, tomorrow and the rest of the next two weeks as a list. Past days aren't
// included, and unfinished items don't carry over.

function renderAgenda() {
  const from = state.focus;
  const to = addDays(from, state.agendaDays - 1);
  const today = todayKey();
  const sections = [];
  for (let k = from; k <= to; k = addDays(k, 1)) {
    const items = state.byDate.get(k) ?? [];
    const holiday = holidayFor(k);
    if (!items.length && !holiday && k !== today) continue;
    const d = parseKey(k);
    const rel = k === today ? "Today" : k === addDays(today, 1) ? "Tomorrow" : k === addDays(today, -1) ? "Yesterday" : null;
    const dateText = `${WEEKDAYS[d.getDay()]}, ${formatShort(k)}${d.getFullYear() !== now.getFullYear() ? `, ${d.getFullYear()}` : ""}`;
    sections.push(h("section", { class: `agenda-day${k === today ? " is-today" : ""}` },
      h("h3", { class: "agenda-date" },
        h("button", { type: "button", class: "agenda-date-btn", onclick: () => openDay(k) },
          rel && h("span", { class: "agenda-rel" }, rel), h("span", {}, dateText))),
      holiday && h("p", { class: "agenda-holiday" }, h("span", { class: "holiday-tag" }, "No school"), " ", holiday),
      items.length
        ? h("ul", { class: "agenda-list" }, items.map((it) => renderAgendaRow(it, k)))
        : h("p", { class: "agenda-empty" }, "Nothing planned")));
  }
  if (!sections.length) sections.push(h("p", { class: "agenda-none" }, "Nothing planned for these dates."));
  return h("div", { class: "agenda" }, sections,
    h("button", { type: "button", class: "btn agenda-more", onclick: () => { state.agendaDays += AGENDA_STEP_DAYS; render(); } },
      "Show 2 more weeks"));
}

function renderAgendaRow(it, key) {
  const meta = [
    it.span && `${formatRange(it.ev.date, it.ev.endDate)} · Day ${it.span.index} of ${it.span.length}`,
    it.ev.series && describeRepeat(it.ev.series.repeat, it.ev.series.date),
  ].filter(Boolean).join(" · ");
  return h("li", { class: `agenda-row${it.ev.done ? " is-done" : ""}`, style: evStyle(it.color) },
    doneBtn(it.ev),
    h("button", { type: "button", class: "agenda-main", onclick: () => openDay(key) },
      h("span", { class: "agenda-line" }, labelParts(it)),
      meta && h("span", { class: "agenda-meta" }, meta)));
}

// ---------- Year view ----------
// Three layouts:
//   calendar: January–December of state.year
//   rolling:  12 months starting at state.month (the current month by default)
//   four:     last month, this month, and the next two, with each month's events listed

const YEAR_MODES = [
  { id: "calendar", label: "Jan–Dec", title: "Calendar year, January to December" },
  { id: "rolling", label: "12 months", title: "12 months starting this month" },
  { id: "four", label: "4 months", title: "Last month, this month and the next two" },
];

function yearViewMonths() {
  if (state.yearMode === "calendar") return Array.from({ length: 12 }, (_, m) => ({ y: state.year, m }));
  const [offset, count] = state.yearMode === "four" ? [-1, 4] : [0, 12];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(state.year, state.month + offset + i, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
}

// Header title for Year view, e.g. "2026", "Oct 2026 – Sep 2027" or "Sep – Dec 2026".
function yearViewTitle() {
  if (state.yearMode === "calendar") return String(state.year);
  const months = yearViewMonths();
  const a = months[0], b = months[months.length - 1];
  return a.y === b.y
    ? `${shortMonth(a.m)} – ${shortMonth(b.m)} ${b.y}`
    : `${shortMonth(a.m)} ${a.y} – ${shortMonth(b.m)} ${b.y}`;
}

function monthLevel(count) {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 7) return 3;
  return 4;
}

function renderYear() {
  const today = todayKey();
  const mode = state.yearMode;

  const switcher = h("div", { class: "year-modes" },
    h("div", { class: "segmented", role: "tablist", "aria-label": "Year view layout" },
      YEAR_MODES.map((ym) => h("button", {
        role: "tab",
        "aria-selected": String(mode === ym.id),
        title: ym.title,
        onclick: () => setYearMode(ym.id),
      }, ym.label))));

  const cards = yearViewMonths().map(({ y, m }) => {
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const ids = new Set(); // each occurrence counted once, even if it spans several days
    const days = [];
    for (let i = 0; i < new Date(y, m, 1).getDay(); i++) days.push(h("span", { class: "mini-day blank" }));
    for (let d = 1; d <= daysInMonth; d++) {
      const key = keyOf(y, m, d);
      const items = state.byDate.get(key) ?? [];
      for (const it of items) ids.add(it.ev.id);
      const cls = ["mini-day"];
      if (items.length === 1) cls.push("has-one");
      if (items.length > 1) cls.push("has-many");
      if (holidayFor(key)) cls.push("holiday");
      if (key === today) cls.push("today");
      days.push(h("span", { class: cls.join(" "), title: holidayFor(key) }, h("span", {}, d)));
    }
    const count = ids.size;

    const isCurrent = y === now.getFullYear() && m === now.getMonth();
    const mini = h("button", {
      class: `mini${count ? " has-events" : ""}${isCurrent ? " is-current" : ""}`,
      "data-level": monthLevel(count),
      "aria-label": `${MONTHS[m]} ${y}${count ? `, ${plural(count, "event")}` : ", no events"}`,
      onclick: () => { state.year = y; state.month = m; setView("month"); },
    },
      h("span", { class: "mini-head" },
        h("span", { class: "mini-name" }, MONTHS[m], mode !== "calendar" && h("small", { class: "mini-year" }, ` ${y}`)),
        count > 0 && h("span", { class: "count" }, count)),
      h("span", { class: "mini-grid", "aria-hidden": "true" },
        WEEKDAYS.map((w) => h("span", { class: "mini-wd" }, w[0])),
        days),
    );
    return mode === "four" ? h("div", { class: "mini-card" }, mini, renderMonthList(y, m)) : mini;
  });

  return h("div", { class: "year-wrap" }, switcher, h("div", { class: `year mode-${mode}` }, cards));
}

// The 4-month layout lists each month's events under its calendar.
const MONTH_LIST_MAX = 6;
function renderMonthList(y, m) {
  const first = keyOf(y, m, 1);
  const entries = [];
  for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
    const key = keyOf(y, m, d);
    for (const it of state.byDate.get(key) ?? []) {
      // List a multi-day event once: on its first day (or the 1st, if it began last month).
      if (it.span && it.ev.date !== key && key !== first) continue;
      entries.push({ it, key });
    }
  }
  if (!entries.length) return h("p", { class: "mini-empty" }, "No events");
  return h("ul", { class: "mini-events" },
    entries.slice(0, MONTH_LIST_MAX).map(({ it, key }) => h("li", {},
      h("button", { class: `mini-ev${it.ev.done ? " is-done" : ""}`, style: evStyle(it.color), onclick: () => openDay(key) },
        h("span", { class: "mini-ev-date" }, it.span ? formatRange(it.ev.date, it.ev.endDate) : formatShort(key)),
        h("span", { class: "mini-ev-title" }, labelParts(it))))),
    entries.length > MONTH_LIST_MAX && h("li", { class: "mini-more" },
      h("button", { class: "link-btn inline", onclick: () => { state.year = y; state.month = m; setView("month"); } },
        `+${entries.length - MONTH_LIST_MAX} more`)));
}

function setYearMode(mode) {
  state.yearMode = mode;
  // Rolling layouts are anchored on the month; start them at today.
  if (mode !== "calendar") { const t = new Date(); state.year = t.getFullYear(); state.month = t.getMonth(); }
  savePref(YEAR_MODE_KEY, mode);
  render();
}

// ---------- Grid gestures ----------
// On an empty part of a day: drag across days to create a multi-day event.
// On an event (chip or banner): drag it onto another day to move it.
// Mouse drags start right away; on touch screens press and hold (~0.4s) first,
// so ordinary scrolling and swiping keep working.

const LONG_PRESS_MS = 400;
const drag = { active: false, pending: null, start: null, end: null, timer: null, suppressClick: false };
const move = { active: false, pending: null, target: null, ghost: null, timer: null, flip: null, flipDir: 0, suppressClick: false };

function attachGridGestures(grid) {
  grid.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".done-btn")) return;
    const handle = e.target.closest(".chip[data-id], .bar[data-id]");
    if (handle) { armGridMove(e, handle); return; }
    const key = e.target.closest(".day[data-key]")?.dataset.key;
    if (key) armSelect(e, key);
  });
  // Stop the long-press menu / text selection on phones.
  grid.addEventListener("contextmenu", (e) => { if (drag.pending || move.pending) e.preventDefault(); });
}

// While dragging on a touch screen, keep the page from scrolling. This listens on
// the whole document because a dragged event's element is parked outside the grid.
document.addEventListener("touchmove", (e) => { if (drag.active || move.active) e.preventDefault(); }, { passive: false });

const suppressNextClick = (obj) => { obj.suppressClick = true; setTimeout(() => { obj.suppressClick = false; }, 50); };

// --- Selecting a range of days ---

function paintRange() {
  const [a, b] = [drag.start, drag.end].sort();
  for (const cell of document.querySelectorAll(".day[data-key]")) {
    const k = cell.dataset.key;
    const on = drag.active && a !== b && k >= a && k <= b;
    cell.classList.toggle("in-range", on);
    cell.classList.toggle("range-start", on && k === a);
    cell.classList.toggle("range-end", on && k === b);
  }
}

function endSelect() {
  clearTimeout(drag.timer);
  drag.active = false;
  drag.pending = null;
  document.body.classList.remove("selecting");
  paintRange();
}

function armSelect(e, key) {
  endSelect();
  drag.start = drag.end = key;
  drag.pending = { x: e.clientX, y: e.clientY, type: e.pointerType };
  if (e.pointerType === "mouse") {
    drag.active = true;
  } else {
    drag.timer = setTimeout(() => {
      if (!drag.pending) return;
      drag.active = true;
      document.body.classList.add("selecting");
      navigator.vibrate?.(15);
      paintRange();
    }, LONG_PRESS_MS);
  }
}

// --- Moving an event (from the grid, or from the day panel) ---

const occById = (id, key) => (state.byDate.get(key) ?? []).find((it) => it.ev.id === id);

function armGridMove(e, handle) {
  const grabKey = handle.classList.contains("bar") ? keyAtBar(handle, e.clientX) : handle.closest(".day").dataset.key;
  const it = occById(handle.dataset.id, grabKey);
  if (!it) return;
  move.pending = { x: e.clientX, y: e.clientY, type: e.pointerType, ev: it.ev, color: it.color, grabKey, mode: "grid", source: handle };
  if (e.pointerType !== "mouse") {
    move.timer = setTimeout(() => { if (move.pending) startMove(move.pending.x, move.pending.y); }, LONG_PRESS_MS);
  }
}

// Panel cards are dragged by their grip, which starts a drag immediately.
function armPanelMove(e, li, it) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  move.pending = { x: e.clientX, y: e.clientY, type: e.pointerType, ev: it.ev, color: it.color, grabKey: state.selected, mode: "panel", source: li };
  startMove(e.clientX, e.clientY);
}

// Someday cards are dragged by their grip onto a day to schedule them.
function armSomedayMove(e, li, ev, color) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  move.pending = { x: e.clientX, y: e.clientY, type: e.pointerType, ev, color, grabKey: null, mode: "someday", source: li };
  startMove(e.clientX, e.clientY);
}

function startMove(x, y) {
  const p = move.pending;
  clearTimeout(move.timer);
  move.active = true;
  move.target = null;
  move.ghost = h("div", { class: "drag-ghost", style: evStyle(p.color) }, p.ev.title);
  document.body.append(move.ghost);
  document.body.classList.add("moving");
  if (p.mode === "panel" || p.mode === "someday") p.source.classList.add("placeholder");
  else p.source.classList.add("lifted");
  // A finger drag keeps sending events to the element it started on. Park that
  // element outside the grid so it survives the grid being redrawn when the
  // month flips; otherwise the drag would stop after the first flip.
  if (p.mode === "grid" && p.type !== "mouse") $("drag-keeper").append(p.source);
  // A Someday item is always headed for the calendar, so move the list out of the way.
  if (p.mode === "someday") document.body.classList.add("sheet-aside");
  if (p.type !== "mouse") navigator.vibrate?.(15);
  updateFlipLabels();
  updateMove(x, y);
}

// Side strips shown while dragging; holding an event over one flips the month (or week).
function updateFlipLabels() {
  let prev = "Wk", next = "Wk";
  if (state.view === "month") {
    prev = shortMonth(new Date(state.year, state.month - 1, 1).getMonth());
    next = shortMonth(new Date(state.year, state.month + 1, 1).getMonth());
  }
  $("flip-prev").querySelector("small").textContent = prev;
  $("flip-next").querySelector("small").textContent = next;
}

// dir: -1 back, 1 forward, 0 stop. Flips after a short hold, then keeps
// flipping once a second while the event stays there.
function setFlip(dir) {
  if (dir === (move.flipDir ?? 0)) return;
  clearTimeout(move.flip);
  move.flip = null;
  move.flipDir = dir;
  $("flip-prev").classList.toggle("armed", dir === -1);
  $("flip-next").classList.toggle("armed", dir === 1);
  if (!dir) return;
  const tick = (delay) => {
    move.flip = setTimeout(() => {
      step(dir);
      updateFlipLabels();
      paintDropTarget();
      tick(1000);
    }, delay);
  };
  tick(600);
}

function updateMove(x, y) {
  const p = move.pending;
  move.ghost.style.transform = `translate(${x + 14}px, ${y + 12}px)`;

  // Inside the day panel's list: reorder. Once the card leaves the panel, the
  // panel moves aside so every day of the calendar can be dropped on.
  if (p.mode === "panel") {
    const list = $("panel-list");
    const r = list.getBoundingClientRect();
    if (!document.body.classList.contains("sheet-aside")
        && x >= r.left && x <= r.right && y >= r.top - 24 && y <= r.bottom + 24) {
      setDropTarget(null);
      placeInList(list, p.source, y);
      return;
    }
    const pr = $("panel").getBoundingClientRect();
    if (x < pr.left || y < pr.top) document.body.classList.add("sheet-aside");
  }

  // Over the calendar: pick the day to move to.
  setDropTarget(isGridView() ? keyFromPoint(x, y) : null);

  // Over a side strip or the ‹ › arrows: flip so you can drag into the next month/week.
  const flipper = document.elementFromPoint(x, y)?.closest?.("#prev, #next, .flip-zone");
  let dir = 0;
  if (flipper && isGridView()) dir = flipper.id === "next" || flipper.id === "flip-next" ? 1 : -1;
  setFlip(dir);
}

function placeInList(list, li, y) {
  const others = [...list.querySelectorAll(".event[data-id]")].filter((el) => el !== li);
  const before = others.find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
  if (before ? li.nextElementSibling !== before : list.lastElementChild !== li) list.insertBefore(li, before ?? null);
}

// Highlights the day(s) the event would land on (a multi-day event keeps its length).
function setDropTarget(key) {
  move.target = key;
  paintDropTarget();
}

function paintDropTarget() {
  for (const el of document.querySelectorAll(".day.drop-target")) el.classList.remove("drop-target");
  const p = move.pending;
  if (!move.active || !move.target || !p) return;
  let from = move.target, to = move.target; // a Someday item lands on just that day
  if (p.ev.date) {
    const shift = daysBetween(p.grabKey, move.target);
    from = addDays(p.ev.date, shift);
    to = addDays(p.ev.endDate || p.ev.date, shift);
  }
  for (const cell of document.querySelectorAll(".day[data-key]")) {
    const k = cell.dataset.key;
    if (k >= from && k <= to) cell.classList.add("drop-target");
  }
}

function endMove() {
  clearTimeout(move.timer);
  setFlip(0);
  $("drag-keeper").replaceChildren();
  move.ghost?.remove();
  move.ghost = null;
  move.pending?.source?.classList.remove("placeholder", "lifted");
  move.active = false;
  move.pending = null;
  move.target = null;
  document.body.classList.remove("moving", "sheet-aside");
  paintDropTarget();
}

function finishMove() {
  const p = move.pending;
  const target = move.target;
  endMove();
  suppressNextClick(move);
  if (p.mode === "someday") { if (target) scheduleSomeday(p.ev, target); else renderSomeday(); return; }
  if (target) moveOccurrence(p.ev, p.grabKey, target);
  else if (p.mode === "panel") commitPanelOrder();
  if (state.selected) renderPanel();
}

// Saves the panel's current card order as this day's manual order.
function commitPanelOrder() {
  const key = state.selected;
  const ids = [...$("panel-list").querySelectorAll(".event[data-id]")].map((el) => el.dataset.id);
  const current = (state.byDate.get(key) ?? []).map((it) => it.ev.id);
  if (ids.join() === current.join()) return;
  run(() => state.store.setDayOrder(key, ids));
}

// --- Shared pointer tracking ---

document.addEventListener("pointermove", (e) => {
  if (move.pending) {
    if (move.active) { updateMove(e.clientX, e.clientY); return; }
    const dist = Math.hypot(e.clientX - move.pending.x, e.clientY - move.pending.y);
    if (move.pending.type === "mouse") { if (dist > 5) startMove(e.clientX, e.clientY); }
    else if (dist > 10) endMove(); // touch moved before the long-press: it's a scroll
    return;
  }
  if (!drag.pending) return;
  if (!drag.active) {
    // A touch that moves before the long-press fires is a scroll or swipe, not a selection.
    if (Math.hypot(e.clientX - drag.pending.x, e.clientY - drag.pending.y) > 10) endSelect();
    return;
  }
  const key = keyFromPoint(e.clientX, e.clientY);
  if (key && key !== drag.end) { drag.end = key; paintRange(); }
});

document.addEventListener("pointerup", () => {
  if (move.pending) {
    if (move.active) finishMove();
    else endMove(); // a plain click on an event: let it open the day
    return;
  }
  if (!drag.pending) return;
  const wasActive = drag.active;
  const [start, end] = [drag.start, drag.end].sort();
  endSelect();
  if (!wasActive || start === end) return;
  suppressNextClick(drag);
  openEventForm({ start, end });
});

document.addEventListener("pointercancel", () => { endMove(); endSelect(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && move.active) { endMove(); if (state.selected) renderPanel(); } });

// ---------- Day panel ----------

function openDay(key) {
  if (state.somedayOpen) closeSomeday();
  state.selected = key;
  state.editing = null;
  render();
  $("panel").classList.add("open");
  $("panel").setAttribute("aria-hidden", "false");
  $("backdrop").hidden = false;
  document.body.classList.add("panel-open");
  $("panel-input").value = "";
  if (matchMedia("(pointer: fine)").matches) $("panel-input").focus();
}

function closePanel() {
  state.selected = null;
  state.editing = null;
  $("panel").classList.remove("open");
  $("panel").setAttribute("aria-hidden", "true");
  $("backdrop").hidden = true;
  document.body.classList.remove("panel-open");
  render();
}

// ---------- Someday ----------
// To-dos without a date. They live in their own list (📥 in the top bar) until
// you drag one onto a day or pick a date for it.

const somedayItems = () => state.events
  .filter((ev) => ev.someday && passesCategoryFilter(ev))
  .sort((a, b) => (Number(!!a.done) - Number(!!b.done)) || a.createdAt - b.createdAt);

function renderSomedayButton() {
  const n = state.events.filter((ev) => ev.someday && !ev.done).length;
  const badge = $("someday-count");
  badge.hidden = !n;
  badge.textContent = n > 99 ? "99+" : String(n);
  $("someday-btn").setAttribute("aria-label", n ? `Someday list, ${plural(n, "to-do")}` : "Someday list");
}

function openSomeday() {
  closeMenu();
  if (state.selected) {
    state.selected = null;
    state.editing = null;
    $("panel").classList.remove("open");
    $("panel").setAttribute("aria-hidden", "true");
  }
  state.somedayOpen = true;
  $("someday").classList.add("open");
  $("someday").setAttribute("aria-hidden", "false");
  $("backdrop").hidden = false;
  document.body.classList.add("panel-open");
  render();
  if (matchMedia("(pointer: fine)").matches) $("someday-input").focus();
}

function closeSomeday() {
  state.somedayOpen = false;
  $("someday").classList.remove("open");
  $("someday").setAttribute("aria-hidden", "true");
  if (!state.selected) {
    $("backdrop").hidden = true;
    document.body.classList.remove("panel-open");
  }
}

function renderSomeday() {
  if (move.active && move.pending?.mode === "someday") return; // don't rebuild under a dragged card
  const items = somedayItems();
  const open = items.filter((ev) => !ev.done).length;
  const done = items.length - open;
  $("someday-sub").textContent = items.length
    ? `${plural(open, "to-do")} without a date${done ? ` · ${done} done` : ""}`
    : "To-dos without a date";
  $("someday-list").replaceChildren(...(items.length
    ? items.map((ev, i) => renderSomedayCard(ev, i % PALETTE_SIZE))
    : [h("li", { class: "empty" }, "Nothing here yet. Add things you need to do but haven't picked a day for.")]));
}

function renderSomedayCard(ev, color) {
  const occ = { ...ev, sid: ev.id, series: null, done: !!ev.done };
  const li = h("li", { class: `event${occ.done ? " is-done" : ""}`, "data-id": ev.id, style: evStyle(color) });
  li.append(
    h("button", {
      type: "button", class: "grip",
      "aria-label": `Drag "${ev.title}" onto a day to schedule it`, title: "Drag onto a day to schedule it",
      onpointerdown: (e) => armSomedayMove(e, li, ev, color),
    }, icon(ICON_GRIP)),
    doneBtn(occ),
    h("div", { class: "event-body" },
      catOf(ev) && h("span", { class: "event-tags" }, catTag(ev, true)),
      h("span", { class: "event-title" }, ev.title)),
    h("div", { class: "event-actions" },
      h("button", { class: "icon-btn small", "aria-label": `Pick a day for "${ev.title}"`, title: "Pick a day",
        onclick: () => openEventForm({ edit: ev, schedule: true }) }, icon(ICON_CALENDAR)),
      h("button", { class: "icon-btn small", "aria-label": `Edit "${ev.title}"`,
        onclick: () => openEventForm({ edit: ev }) }, icon(ICON_EDIT)),
      h("button", { class: "icon-btn small danger", "aria-label": `Delete "${ev.title}"`,
        onclick: () => deleteOccurrence(occ) }, icon(ICON_DELETE))));
  return li;
}

async function scheduleSomeday(ev, date) {
  await run(() => state.store.update(ev.id, { someday: null, date }));
  showToast(`Scheduled "${ev.title}" for ${formatShort(date)}`, "Undo",
    () => run(() => state.store.update(ev.id, { someday: true, date: null })));
}

async function addSomeday(title) {
  title = title.trim();
  if (!title) return;
  const match = suggestionFor(title);
  await run(() => state.store.add({ title, someday: true, category: match?.category || null }));
}

function renderPanel() {
  const key = state.selected;
  const dt = parseKey(key);
  const items = state.byDate.get(key) ?? [];
  const doneCount = items.filter((it) => it.ev.done).length;

  $("panel-title").textContent = `${WEEKDAYS[dt.getDay()]}, ${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
  $("panel-sub").textContent = `${dt.getFullYear()} · ${items.length ? plural(items.length, "event") : "No events"}`
    + (doneCount ? ` · ${doneCount} done` : "")
    + (state.hiddenCats.size ? " · some categories hidden" : "");
  const hiddenRepeats = hiddenRepeatingOn(key);
  $("panel-repeat-note").hidden = !hiddenRepeats;
  $("panel-repeat-text").textContent = `${plural(hiddenRepeats, "repeating event")} hidden`;
  const holiday = holidayFor(key);
  $("panel-holiday").hidden = !holiday;
  $("panel-holiday-name").textContent = holiday ?? "";

  // If the event being edited disappeared (deleted elsewhere), drop the edit.
  if (state.editing && !items.some((it) => it.ev.id === state.editing.id)) state.editing = null;
  // Show "Reset to automatic" only if this day really uses a hand-made order.
  const manual = state.dayOrders[key];
  $("panel-order").hidden = !(manual && items.length > 1 && items.some((it) => manual.includes(it.ev.id)));

  // Don't rebuild the list under a card that's being dragged.
  if (move.active && move.pending?.mode === "panel") return;
  const focused = document.activeElement?.closest?.(".edit-form") ? document.activeElement.name : null;

  const list = items.map((it) => (state.editing?.id === it.ev.id ? renderEditCard(it) : renderCard(it)));
  if (!items.length) list.push(h("li", { class: "empty" }, "Nothing planned. Add a to-do above."));
  $("panel-list").replaceChildren(...list);

  if (focused) $("panel-list").querySelector(`.edit-form [name="${focused}"]`)?.focus();
}

function renderCard(it) {
  const occ = it.ev;
  const li = h("li", { class: `event${occ.done ? " is-done" : ""}`, "data-id": occ.id, style: evStyle(it.color) });
  li.append(
    h("button", {
      type: "button",
      class: "grip",
      "aria-label": `Move "${occ.title}". Drag to reorder or onto another day; or use the up and down arrow keys.`,
      title: "Drag to reorder, or onto a day to move it",
      onpointerdown: (e) => armPanelMove(e, li, it),
      onkeydown: (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const ids = (state.byDate.get(state.selected) ?? []).map((x) => x.ev.id);
        const i = ids.indexOf(occ.id);
        const j = i + (e.key === "ArrowUp" ? -1 : 1);
        if (j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        run(() => state.store.setDayOrder(state.selected, ids))
          .then(() => $("panel-list").querySelector(`.event[data-id="${CSS.escape(occ.id)}"] .grip`)?.focus());
      },
    }, icon(ICON_GRIP)),
    doneBtn(occ),
    h("div", { class: "event-body" },
      (it.time || it.span || occ.series || catOf(occ)) && h("span", { class: "event-tags" },
        catTag(occ, true),
        it.time && h("span", { class: "time" }, it.time.label),
        it.span && h("span", { class: "range" },
          `${formatRange(occ.date, occ.endDate)} · Day ${it.span.index} of ${it.span.length}`),
        occ.series && h("span", { class: "range" }, `↻ ${describeRepeat(occ.series.repeat, occ.series.date)}`)),
      h("span", { class: "event-title" }, displayTitle(it))),
    h("div", { class: "event-actions" },
      h("button", { class: "icon-btn small", "aria-label": `Edit "${occ.title}"`,
        onclick: () => {
          state.editing = { id: occ.id, draft: draftFromOcc(occ) };
          renderPanel();
          $("panel-list").querySelector(".edit-form input")?.focus();
        } }, icon(ICON_EDIT)),
      h("button", { class: "icon-btn small danger", "aria-label": `Delete "${occ.title}"`,
        onclick: () => deleteOccurrence(occ) }, icon(ICON_DELETE))),
  );
  return li;
}

function renderEditCard(it) {
  const occ = it.ev;
  const cancel = () => { state.editing = null; renderPanel(); };
  return h("li", { class: "event editing", style: evStyle(it.color) },
    buildEventForm(state.editing.draft, {
      compact: true,
      submitLabel: "Save",
      onCancel: cancel,
      onSubmit: async (values) => { state.editing = null; await saveEdit(occ, values); },
    }));
}

function blankDraft(start, end) {
  return { title: "", date: start, endDate: end ?? start, category: "", freq: "none", interval: 1,
    days: [parseKey(start).getDay()], until: "", someday: false };
}

const WEEKDAYS_ONLY = "1,2,3,4,5";

function draftFromOcc(occ) {
  const src = occ.series ?? occ;
  const r = src.repeat;
  const date = occ.date ?? todayKey(); // Someday items get today as a starting point
  const weekdays = r?.freq === "weekly" && (r.interval ?? 1) === 1 && r.days?.join() === WEEKDAYS_ONLY;
  return {
    title: occ.title, date, endDate: occ.endDate || date, category: occ.category ?? "",
    freq: weekdays ? "weekdays" : r?.freq ?? "none", interval: r?.interval ?? 1,
    days: r?.days ?? [parseKey(date).getDay()], until: r?.until ?? "",
    someday: !!occ.someday,
  };
}

// New To date after From changes: To follows From while it's a one-day event
// (or empty / now before From); a later end date you picked is kept.
const followStart = (oldStart, newStart, end) =>
  (!end || end < newStart || end === oldStart ? newStart : end);

// Puts start/end in order and caps the length. Returns { date, endDate } where
// endDate is null for a one-day event, or null if the dates are missing.
function normalizeRange(start, end) {
  if (!start) return null;
  if (!end || end === start) return { date: start, endDate: null };
  let [a, b] = [start, end].sort();
  if (spanLength(a, b) > MAX_SPAN_DAYS) b = addDays(a, MAX_SPAN_DAYS - 1);
  return { date: a, endDate: b };
}

const describeRange = ({ date, endDate }) => endDate
  ? `${formatRange(date, endDate)} (${spanLength(date, endDate)} days)`
  : formatShort(date);

// The draft's repeat setting as a stored rule ("Every weekday" is weekly Mon–Fri).
function ruleFromDraft(d, start) {
  if (d.freq === "none") return null;
  if (d.freq === "weekdays") return normalizeRepeat({ freq: "weekly", interval: 1, days: [1, 2, 3, 4, 5], until: d.until || null }, start);
  return normalizeRepeat({ freq: d.freq, interval: d.interval, days: d.days, until: d.until || null }, start);
}

// Turns a draft into what's saved: { title, date, endDate, category, repeat, someday } (nulls = none).
function valuesFromDraft(d) {
  const title = d.title.trim();
  if (!title) return null;
  if (d.someday) return { title, date: null, endDate: null, category: d.category || null, repeat: null, someday: true };
  const range = normalizeRange(d.date, d.endDate);
  if (!range) return null;
  return { title, ...range, category: d.category || null, repeat: ruleFromDraft(d, range.date), someday: null };
}

// ---------- Title suggestions ----------
// While you type a title, titles you've used before are suggested, so a repeat
// appointment ("2pm Dr. Patel") fills in with its category after a few letters.

function titleIndex() {
  const byTitle = new Map();
  for (const ev of state.events) {
    const title = ev.title.trim();
    const key = title.toLowerCase();
    const when = ev.date ?? "";
    const prev = byTitle.get(key);
    if (!prev || when > prev.when) byTitle.set(key, { title, category: ev.category ?? "", when });
  }
  return byTitle;
}

// The most recent event with exactly this title (any capitalization), if any.
const suggestionFor = (title) => titleIndex().get(title.trim().toLowerCase()) ?? null;

function titleSuggestions(query, limit = 6) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const wordStart = (title) => title.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q));
  return [...titleIndex().values()]
    .filter((s) => s.title.toLowerCase().includes(q) && s.title.toLowerCase() !== q)
    .map((s) => ({ ...s, rank: s.title.toLowerCase().startsWith(q) ? 0 : wordStart(s.title) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || b.when.localeCompare(a.when))
    .slice(0, limit);
}

// Adds a suggestion list under a title input. onPick(suggestion) runs when one is chosen
// (tap it, or use ↑/↓ and Enter).
function attachSuggestions(input, onPick) {
  const list = h("ul", { class: "suggest", role: "listbox", "aria-label": "Earlier events" });
  list.hidden = true;
  input.parentElement.classList.add("suggest-host");
  input.after(list);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  let items = [];
  let active = -1;

  const close = () => { list.hidden = true; items = []; active = -1; input.setAttribute("aria-expanded", "false"); };
  const pick = (s) => { close(); onPick(s); };
  const paint = () => [...list.children].forEach((li, i) => li.classList.toggle("active", i === active));
  const update = () => {
    items = titleSuggestions(input.value);
    if (!items.length || document.activeElement !== input) { close(); return; }
    list.replaceChildren(...items.map((s) => h("li", {
      role: "option", class: "suggest-item",
      // mousedown (not click) so the input keeps focus and the list doesn't close first.
      onmousedown: (e) => { e.preventDefault(); pick(s); },
    }, catTag(s), h("span", { class: "suggest-title" }, s.title),
      s.when && h("span", { class: "suggest-when" }, formatShort(s.when)))));
    list.hidden = false;
    active = -1;
    input.setAttribute("aria-expanded", "true");
  };

  input.addEventListener("input", update);
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); e.stopPropagation(); pick(items[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

// ---------- Event form (new event + edit) ----------
// A draft is { title, date, endDate, category, freq, interval, days, until, someday };
// freq "none" means it doesn't repeat. The form edits the draft in place, so
// re-rendering keeps what you've typed.

function buildEventForm(d, { compact = false, submitLabel = "Save", onSubmit, onCancel }) {
  const form = h("form", { class: `event-form${compact ? " edit-form" : ""}`, autocomplete: "off" });
  const spanHint = h("p", { class: "span-hint" });
  const repeatBox = h("div", { class: "repeat-box" });

  const updateSpanHint = () => {
    const n = d.date && d.endDate && d.endDate > d.date ? spanLength(d.date, d.endDate) : 0;
    spanHint.textContent = n ? `${formatRange(d.date, d.endDate)} · ${n} days` : "One day";
  };

  const title = h("input", { type: "text", name: "title", maxlength: "500", required: true, value: d.title,
    placeholder: "e.g. 10:30am Team meeting", "aria-label": "Title", oninput: (e) => { d.title = e.target.value; } });
  const end = h("input", { type: "date", name: "endDate", value: d.endDate, min: d.date, "aria-label": "To",
    oninput: (e) => { d.endDate = e.target.value; updateSpanHint(); } });
  const start = h("input", { type: "date", name: "date", required: !d.someday, value: d.date, "aria-label": "From",
    oninput: (e) => {
      d.endDate = followStart(d.date, e.target.value, d.endDate);
      // Weekly repeats on the start's weekday follow the start date too.
      if (d.days.length === 1 && d.days[0] === parseKey(d.date).getDay() && e.target.value) d.days = [parseKey(e.target.value).getDay()];
      d.date = e.target.value;
      end.value = d.endDate;
      end.min = d.date;
      updateSpanHint();
      renderRepeat();
    } });

  // Category menu, ending with "+ New category…", which opens the category editor
  // and selects the new category when you save.
  const NEW_CATEGORY = "__new";
  const category = h("select", { name: "category", "aria-label": "Category",
    onchange: (e) => {
      if (e.target.value !== NEW_CATEGORY) { d.category = e.target.value; return; }
      e.target.value = d.category;
      openCategories({
        addNew: true,
        onSaved: (created) => {
          if (created) d.category = created.id;
          if (category.isConnected) { fillCategories(); category.focus(); }
          else if (state.selected) renderPanel(); // the panel was redrawn; rebuild it from the draft
        },
      });
    } });
  const fillCategories = () => {
    category.replaceChildren(
      h("option", { value: "" }, "No category"),
      ...state.categories.map((c) => h("option", { value: c.id }, `${c.short ? `${c.short} · ` : ""}${c.name}`)),
      h("option", { value: NEW_CATEGORY }, "+ New category…"));
    if (!state.categories.some((c) => c.id === d.category)) d.category = "";
    category.value = d.category;
  };
  fillCategories();

  const freq = h("select", { name: "freq", "aria-label": "Repeat",
    onchange: (e) => { d.freq = e.target.value; renderRepeat(); } },
    [["none", "Doesn't repeat"], ["daily", "Every day"], ["weekdays", "Every weekday (Mon–Fri)"], ["weekly", "Every week"],
      ["monthly", "Every month"], ["yearly", "Every year"]]
      .map(([v, label]) => h("option", { value: v }, label)));
  freq.value = d.freq;

  function renderRepeat() {
    if (d.freq === "none" || d.someday) { repeatBox.replaceChildren(); repeatBox.hidden = true; return; }
    repeatBox.hidden = false;
    const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[d.freq];
    const summary = h("p", { class: "repeat-summary" });
    const updateSummary = () => {
      const rule = ruleFromDraft(d, d.date);
      summary.textContent = rule ? `↻ ${describeRepeat(rule, d.date)}` : "";
    };
    // (replaceChildren would print a `false` as text, so leave out the parts not shown.)
    repeatBox.replaceChildren(...[
      h("div", { class: "repeat-row" },
        unit && h("label", { class: "inline-label" }, "Every",
          h("input", { type: "number", name: "interval", min: "1", max: "99", value: String(d.interval), class: "interval",
            oninput: (e) => { d.interval = Math.max(1, Math.min(99, Number(e.target.value) || 1)); updateSummary(); } }),
          `${unit}(s)`),
        h("label", { class: "inline-label" }, "Ends",
          h("input", { type: "date", name: "until", value: d.until, min: d.date,
            oninput: (e) => { d.until = e.target.value; updateSummary(); } }),
          h("button", { type: "button", class: "icon-btn small", "aria-label": "Repeat forever", title: "Never ends",
            onclick: (e) => { d.until = ""; e.currentTarget.previousElementSibling.value = ""; updateSummary(); } }, icon(ICON_CLEAR)))),
      d.freq === "weekly" && h("div", { class: "weekday-picks", role: "group", "aria-label": "Repeat on" },
        WEEKDAYS.map((w, i) => h("button", {
          type: "button",
          class: `day-pick${d.days.includes(i) ? " on" : ""}`,
          "aria-pressed": String(d.days.includes(i)),
          "aria-label": w,
          onclick: (e) => {
            d.days = d.days.includes(i) ? d.days.filter((x) => x !== i) : [...d.days, i].sort();
            if (!d.days.length) d.days = [i]; // keep at least one day
            for (const b of e.currentTarget.parentElement.children) {
              const on = d.days.includes([...b.parentElement.children].indexOf(b));
              b.classList.toggle("on", on);
              b.setAttribute("aria-pressed", String(on));
            }
            updateSummary();
          },
        }, w[0]))),
      summary].filter(Boolean));
    updateSummary();
  }

  // "No date yet (Someday)" hides the dates and repeat options.
  const dateBlock = h("div", { class: "date-block" },
    h("div", { class: "date-pair" },
      h("label", { class: "field" }, h("span", {}, "From"), start),
      h("label", { class: "field" }, h("span", {}, "To"),
        h("span", { class: "end-wrap" }, end,
          h("button", { type: "button", class: "icon-btn small", "aria-label": "Make it a one-day event", title: "Make it a one-day event",
            onclick: () => { d.endDate = d.date; end.value = d.date; updateSpanHint(); } }, icon(ICON_CLEAR))))),
    spanHint);
  const repeatField = h("label", { class: "field" }, h("span", {}, "Repeat"), freq);
  const updateSomeday = () => {
    dateBlock.hidden = d.someday;
    repeatField.hidden = d.someday;
    start.required = !d.someday;
    renderRepeat();
  };
  const somedayToggle = h("label", { class: "check-row" },
    h("input", { type: "checkbox", name: "someday", checked: d.someday,
      onchange: (e) => { d.someday = e.target.checked; updateSomeday(); } }),
    h("span", {}, "No date yet ", h("span", { class: "muted" }, "(add to Someday)")));

  const titleField = h("label", { class: "field" }, h("span", {}, "Title"), title);
  form.append(
    titleField,
    somedayToggle,
    dateBlock,
    h("div", { class: "date-pair" },
      h("label", { class: "field" }, h("span", {}, "Category"), category),
      repeatField),
    repeatBox,
    h("div", { class: "dialog-actions" },
      h("button", { type: "button", class: "btn ghost", onclick: onCancel }, "Cancel"),
      h("button", { type: "submit", class: "btn primary" }, submitLabel)));

  // Picking an earlier title also brings its category along.
  attachSuggestions(title, (s) => {
    d.title = s.title;
    title.value = s.title;
    if (s.category && state.categories.some((c) => c.id === s.category)) {
      d.category = s.category;
      category.value = s.category;
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const values = valuesFromDraft(d);
    if (values) onSubmit(values);
  });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } });
  updateSpanHint();
  updateSomeday();
  return form;
}

// Opens the event form in a dialog.
//   openEventForm()                          new event on a sensible day
//   openEventForm({ start, end })            new event with dates filled in (drag-select, panel)
//   openEventForm({ someday: true })         new Someday to-do
//   openEventForm({ edit: ev, schedule })    edit a Someday item (schedule: pick a day for it)
function openEventForm(opts = {}) {
  let draft, heading, onSubmit;
  if (opts.edit) {
    draft = draftFromOcc(opts.edit);
    if (opts.schedule) draft.someday = false;
    heading = opts.schedule ? "Pick a day" : draft.someday ? "Edit to-do" : "Edit event";
    onSubmit = async (values) => { closeEventForm(); await updateFromForm(opts.edit, values); };
  } else {
    const t = todayKey();
    let start = opts.start ?? state.selected;
    if (!start) {
      if (state.view === "month") {
        const viewingThisMonth = state.year === now.getFullYear() && state.month === now.getMonth();
        start = viewingThisMonth ? t : keyOf(state.year, state.month, 1);
      } else if (state.view === "week") {
        const ws = weekStartOf(state.focus);
        start = t >= ws && t <= addDays(ws, 6) ? t : ws;
      } else {
        start = t;
      }
    }
    draft = blankDraft(start, opts.end);
    draft.someday = !!opts.someday;
    heading = draft.someday ? "New to-do" : opts.end && opts.end !== start ? "New multi-day event" : "New event";
    onSubmit = async (values) => { closeEventForm(); await addEvent(values); };
  }
  $("quick-heading").textContent = heading;
  $("quick-host").replaceChildren(buildEventForm(draft, { submitLabel: "Save", onCancel: closeEventForm, onSubmit }));
  $("quick-add").hidden = false;
  const titleInput = $("quick-host").querySelector("input[name=title]");
  if (opts.schedule) $("quick-host").querySelector("input[name=date]").focus();
  else titleInput.focus();
}

function closeEventForm() {
  $("quick-add").hidden = true;
  if (state.somedayOpen) $("someday-input").focus();
  else $("fab").focus();
}

// ---------- Actions ----------

async function run(fn) {
  try { return await fn(); }
  catch (err) { console.error(err); showToast(friendlyError(err)); return undefined; }
}

function friendlyError(err) {
  if (err?.code === "permission-denied") return "Not allowed. Check that you're signed in and the Firestore rules are up to date.";
  if (err?.code === "auth/unauthorized-domain") return "This site isn't on Firebase's authorized domains list yet (see README).";
  return err?.message ? `Something went wrong: ${err.message}` : "Something went wrong.";
}

const stored = (id) => state.events.find((e) => e.id === id);

// Brings the calendar to a date in the current view.
function goToDate(key) {
  const d = parseKey(key);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  if (state.view === "week") state.focus = key;
  if (state.view === "agenda" && (key < state.focus || key > addDays(state.focus, state.agendaDays - 1))) state.focus = key;
}

// Typing a title you've used before (without picking a category) reuses that event's category.
const withRememberedCategory = (values) => (values.category ? values
  : { ...values, category: suggestionFor(values.title)?.category || null });

const whenText = (v) => (v.repeat ? lcFirst(describeRepeat(v.repeat, v.date)) : v.endDate ? describeRange(v) : formatShort(v.date));

async function addEvent(values) {
  values = withRememberedCategory(values);
  const id = await run(() => state.store.add(values));
  if (!id) return;
  if (values.someday) { showToast(`Added "${values.title}" to Someday`); return; }
  goToDate(values.date);
  render();
  showToast(`Added "${values.title}" · ${whenText(values)}`);
}

async function addQuick(title, date) {
  title = title.trim();
  if (!title || !date) return;
  await run(() => state.store.add(withRememberedCategory({ title, date })));
}

// Saves the form for a Someday item (edited, or given a date).
async function updateFromForm(ev, v) {
  await run(() => state.store.update(ev.id, { ...v, done: ev.done || null }));
  if (v.someday) { showToast(`Saved "${v.title}"`); return; }
  goToDate(v.date);
  render();
  showToast(`Scheduled "${v.title}" · ${whenText(v)}`);
}

// Small "which one?" dialog for repeating events. Resolves to the chosen id, or null.
function askChoice(title, text, options) {
  return new Promise((resolve) => {
    const modal = $("choice");
    const close = (value) => { modal.hidden = true; modal.onkeydown = null; resolve(value); };
    $("choice-title").textContent = title;
    $("choice-text").textContent = text;
    $("choice-buttons").replaceChildren(...options.map((o) =>
      h("button", { type: "button", class: `btn ${o.kind ?? ""}`, onclick: () => close(o.id) }, o.label)));
    modal.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(null); } };
    modal.onclick = (e) => { if (e.target === modal) close(null); };
    modal.hidden = false;
    $("choice-buttons").querySelector("button")?.focus();
  });
}

const askScope = (verb, occ) => askChoice(`${verb} repeating event`,
  `"${occ.title}" repeats (${lcFirst(describeRepeat(occ.series.repeat, occ.series.date))}). ${verb} just this one (${formatShort(occ.date)}), or every event in the series?`,
  [{ id: "one", label: "Just this one" }, { id: "all", label: "All events", kind: "primary" }, { id: null, label: "Cancel", kind: "ghost" }]);

const withException = (series, date) => [...new Set([...(series.exceptions ?? []), date])].sort();

async function saveEdit(occ, v) {
  const series = occ.series;
  if (!series) {
    await run(() => state.store.update(occ.sid, { ...v, done: v.repeat ? null : occ.done || null }));
    showToast(v.someday ? `Moved "${v.title}" to Someday`
      : v.repeat ? `Now repeats ${lcFirst(describeRepeat(v.repeat, v.date))}` : `Saved "${v.title}"`);
    render();
    return;
  }
  const scope = await askScope("Change", occ);
  if (!scope) { render(); return; }
  if (scope === "one") {
    // Split this date off into its own event; the series skips it.
    await run(() => state.store.add({ ...v, repeat: null, done: occ.done || null }));
    await run(() => state.store.update(series.id, { exceptions: withException(series, occ.date) }));
    showToast(`Changed just ${formatShort(occ.date)}`);
  } else if (!v.repeat) {
    // "Doesn't repeat" for the whole series: it becomes one event on the chosen date.
    await run(() => state.store.update(series.id, { ...v, repeat: null, exceptions: null, doneDates: null, done: occ.done || null }));
    showToast(v.someday ? `Moved "${v.title}" to Someday` : `"${v.title}" no longer repeats`);
  } else {
    // Shift the whole series by however far this occurrence was moved.
    const shift = daysBetween(occ.date, v.date);
    const date = addDays(series.date, shift);
    const endDate = v.endDate ? addDays(date, daysBetween(v.date, v.endDate)) : null;
    const shiftAll = (list) => (list?.length && shift ? list.map((k) => addDays(k, shift)) : list ?? null);
    await run(() => state.store.update(series.id, {
      title: v.title, category: v.category, date, endDate,
      repeat: normalizeRepeat(v.repeat, date),
      exceptions: shiftAll(series.exceptions), doneDates: shiftAll(series.doneDates),
    }));
    showToast(`Updated every "${v.title}"`);
  }
  render();
}

async function deleteOccurrence(occ) {
  const original = stored(occ.sid);
  if (!original) return;
  if (occ.series) {
    const scope = await askScope("Delete", occ);
    if (!scope) return;
    if (scope === "one") {
      await run(() => state.store.update(original.id, { exceptions: withException(original, occ.date) }));
      showToast(`Deleted "${occ.title}" on ${formatShort(occ.date)}`, "Undo",
        () => run(() => state.store.update(original.id, { exceptions: original.exceptions ?? null })));
      return;
    }
    await run(() => state.store.remove(original.id));
    showToast(`Deleted every "${occ.title}"`, "Undo", () => run(() => state.store.restore(original)));
    return;
  }
  await run(() => state.store.remove(original.id));
  const what = isSpan(original) ? `"${original.title}" (all ${spanLength(original.date, original.endDate)} days)` : `"${original.title}"`;
  showToast(`Deleted ${what}`, "Undo", () => run(() => state.store.restore(original)));
}

async function toggleDone(occ) {
  const original = stored(occ.sid);
  if (!original) return;
  if (occ.series) {
    const dates = new Set(original.doneDates ?? []);
    if (dates.has(occ.date)) dates.delete(occ.date);
    else dates.add(occ.date);
    await run(() => state.store.update(original.id, { doneDates: [...dates].sort() }));
  } else {
    await run(() => state.store.update(original.id, { done: !original.done || null }));
  }
}

// Dragging moves just the occurrence you grabbed (for a repeating event, that
// date is split off into its own event and the rest of the series stays put).
async function moveOccurrence(occ, grabKey, dropKey) {
  const shift = daysBetween(grabKey, dropKey);
  if (!shift) return;
  const after = { date: addDays(occ.date, shift), endDate: occ.endDate ? addDays(occ.endDate, shift) : null };
  const original = stored(occ.sid);
  if (!original) return;
  if (!occ.series) {
    const before = { date: original.date, endDate: original.endDate || null };
    await run(() => state.store.update(original.id, after));
    showToast(`Moved "${occ.title}" to ${describeRange(after)}`, "Undo", () => run(() => state.store.update(original.id, before)));
    return;
  }
  const newId = await run(() => state.store.add({
    title: occ.title, category: occ.category ?? null, ...after, done: occ.done || null,
  }));
  if (!newId) return;
  await run(() => state.store.update(original.id, { exceptions: withException(original, occ.date) }));
  showToast(`Moved this "${occ.title}" to ${describeRange(after)} (the rest still repeat)`, "Undo", async () => {
    await run(() => state.store.remove(newId));
    await run(() => state.store.update(original.id, { exceptions: original.exceptions ?? null }));
  });
}

let toastTimer;
function showToast(text, actionLabel, onAction) {
  const toast = $("toast");
  const btn = $("toast-action");
  $("toast-text").textContent = text;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel ?? "";
  btn.onclick = () => { toast.hidden = true; onAction?.(); };
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, actionLabel ? 6000 : 3500);
}

// ---------- Search ----------

function openSearch() {
  closeMenu();
  $("search").hidden = false;
  $("search-input").value = "";
  renderSearch("");
  $("search-input").focus();
}

function closeSearch() { $("search").hidden = true; }

const SEARCH_LIMIT = 50;
function renderSearch(query) {
  const q = query.trim().toLowerCase();
  const list = $("search-results");
  if (!q) {
    list.replaceChildren(h("li", { class: "search-hint" }, "Search every event by title or category."));
    return;
  }
  const today = todayKey();
  const hits = state.events
    .filter((ev) => ev.title.toLowerCase().includes(q)
      || catOf(ev)?.name.toLowerCase().includes(q) || catOf(ev)?.short?.toLowerCase() === q)
    .map((ev) => {
      if (ev.someday) return { ev, when: null, group: 1 };
      const next = nextOccurrence(ev, today);
      return { ev, when: next ?? ev.repeat?.until ?? ev.date, group: next ? 0 : 2 };
    })
    // Upcoming (soonest first), then Someday, then past (most recent first).
    .sort((a, b) => a.group - b.group
      || (a.group === 0 ? a.when.localeCompare(b.when) : a.group === 2 ? b.when.localeCompare(a.when) : a.ev.createdAt - b.ev.createdAt));

  if (!hits.length) {
    list.replaceChildren(h("li", { class: "search-hint" }, `No events match "${query.trim()}".`));
    return;
  }
  list.replaceChildren(...hits.slice(0, SEARCH_LIMIT).map(({ ev, when, group }) => {
    const done = ev.someday ? !!ev.done : makeOcc(ev, when).done;
    const meta = [
      ev.repeat ? `↻ ${describeRepeat(ev.repeat, ev.date)}` : isSpan(ev) ? formatRange(ev.date, ev.endDate) : null,
      group === 2 && "Past",
      done && "Done",
    ].filter(Boolean).join(" · ");
    const open = () => {
      closeSearch();
      if (ev.someday) { openSomeday(); return; }
      goToDate(when);
      openDay(when);
    };
    return h("li", {},
      h("button", { type: "button", class: `search-hit${done ? " is-done" : ""}`, onclick: open },
        h("span", { class: "search-date" }, ev.someday ? "Someday" : ev.repeat && group === 0 ? `Next ${formatLong(when)}` : formatLong(when)),
        h("span", { class: "search-title" }, catTag(ev), ev.title),
        meta && h("span", { class: "search-meta" }, meta)));
  }), ...(hits.length > SEARCH_LIMIT ? [h("li", { class: "search-hint" }, `Showing the first ${SEARCH_LIMIT} of ${hits.length}.`)] : []));
}

// ---------- Categories ----------

let catDrafts = [];
let catDialog = {}; // { onSaved } when opened from the event form

// opts.addNew: start with a blank row ready to type in.
// opts.onSaved(created): called after saving, with the newly added category (if any).
function openCategories(opts = {}) {
  closeMenu();
  catDialog = opts;
  catDrafts = state.categories.map((c) => ({ ...c }));
  colorPickerFor = null;
  if (opts.addNew) addCategoryRow();
  renderCategoryRows();
  $("cats").hidden = false;
  const inputs = $("cats-list").querySelectorAll(".cat-name");
  (opts.addNew ? inputs[inputs.length - 1] : inputs[0])?.focus();
  if (!inputs.length) $("cats-add").focus();
}

function addCategoryRow() {
  const used = new Set(catDrafts.map((c) => c.color));
  const color = [...Array(CAT_COLORS).keys()].find((c) => !used.has(c)) ?? catDrafts.length % CAT_COLORS;
  catDrafts.push({ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: "", short: "", color });
}

function closeCategories() { $("cats").hidden = true; }

function renderCategoryRows() {
  if (!catDrafts.length) {
    $("cats-list").replaceChildren(h("li", { class: "cats-empty" }, "No categories yet. Add your first one below."));
    return;
  }
  $("cats-list").replaceChildren(...catDrafts.flatMap((c, i) => {
    const open = colorPickerFor === c.id;
    const row = h("li", { class: "cat-row" },
      h("button", {
        type: "button", class: `cat-color${open ? " open" : ""}`, style: catStyle(c),
        "aria-label": `Color for ${c.name || "new category"}: ${CAT_COLOR_NAMES[c.color % CAT_COLORS]}. Choose a color`,
        "aria-expanded": String(open),
        title: "Choose a color",
        onclick: () => { colorPickerFor = open ? null : c.id; renderCategoryRows(); focusCatColor(c.id, !open); },
      }),
      h("input", { type: "text", class: "cat-short", maxlength: "4", value: c.short ?? "", placeholder: "Tag", "aria-label": "Short tag",
        oninput: (e) => { c.short = e.target.value; } }),
      h("input", { type: "text", class: "cat-name", maxlength: "24", value: c.name, placeholder: "Name", "aria-label": "Category name",
        oninput: (e) => { c.name = e.target.value; } }),
      h("button", { type: "button", class: "icon-btn small danger", "aria-label": `Remove ${c.name || "category"}`,
        onclick: () => { catDrafts.splice(i, 1); renderCategoryRows(); } }, icon(ICON_DELETE)));
    if (!open) return [row];

    // The color picker: all colors by name; ones another category uses are marked.
    const usedBy = (n) => catDrafts.filter((o) => o !== c && o.color % CAT_COLORS === n).map((o) => o.name || "another category");
    const picker = h("li", { class: "cat-picker", role: "radiogroup", "aria-label": `Color for ${c.name || "new category"}` },
      Array.from({ length: CAT_COLORS }, (_, n) => {
        const users = usedBy(n);
        const selected = c.color % CAT_COLORS === n;
        return h("button", {
          type: "button", role: "radio", "data-color": n,
          class: `swatch-btn${selected ? " selected" : ""}${users.length ? " used" : ""}`,
          style: catStyle({ color: n }),
          "aria-checked": String(selected),
          "aria-label": `${CAT_COLOR_NAMES[n]}${users.length ? ` (used by ${users.join(", ")})` : ""}`,
          title: `${CAT_COLOR_NAMES[n]}${users.length ? ` · used by ${users.join(", ")}` : ""}`,
          onclick: () => { c.color = n; colorPickerFor = null; renderCategoryRows(); focusCatColor(c.id); },
          onkeydown: (e) => {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (!step) return;
            e.preventDefault();
            e.currentTarget.parentElement.children[(n + step + CAT_COLORS) % CAT_COLORS].focus();
          },
        }, selected && icon(ICON_CHECK), h("span", { class: "swatch-name" }, CAT_COLOR_NAMES[n]));
      }));
    return [row, picker];
  }));
}

let colorPickerFor = null; // id of the category whose color picker is open
const CAT_COLOR_NAMES = ["Blue", "Orange", "Purple", "Red", "Teal", "Pink", "Gold", "Slate"];

// After re-rendering, put focus back on the category's color dot (or its selected swatch).
function focusCatColor(id, intoPicker = false) {
  const index = catDrafts.findIndex((c) => c.id === id);
  const rows = $("cats-list").querySelectorAll(".cat-row");
  if (intoPicker) $("cats-list").querySelector(".cat-picker .swatch-btn.selected")?.focus();
  else rows[index]?.querySelector(".cat-color")?.focus();
}

async function saveCategories() {
  const categories = catDrafts
    .map((c) => ({ ...c, name: c.name.trim(), short: (c.short ?? "").trim() }))
    .filter((c) => c.name)
    .map((c) => ({ id: c.id, name: c.name, short: c.short || c.name.slice(0, 3).toUpperCase(), color: c.color % CAT_COLORS }));
  const before = new Set(state.categories.map((c) => c.id));
  const created = categories.find((c) => !before.has(c.id)) ?? null;
  const { onSaved } = catDialog;
  closeCategories();
  await run(() => state.store.setSettings({ categories }));
  state.categories = categories; // don't wait for the sync round-trip before updating the form
  onSaved?.(created);
  showToast(created ? `Added category "${created.name}"` : "Categories saved");
}

function toggleCategoryFilter(id) {
  const next = new Set(state.hiddenCats);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setHiddenCats(next);
}

function setHiddenCats(set) {
  state.hiddenCats = set;
  savePref(HIDDEN_CATS_KEY, JSON.stringify([...set]));
  render();
}

function setHideRepeating(hide) {
  state.hideRepeating = hide;
  savePref(HIDE_REPEATING_KEY, hide ? "1" : "0");
  render();
}

function showEverything() {
  state.hideRepeating = false;
  savePref(HIDE_REPEATING_KEY, "0");
  setHiddenCats(new Set());
}

// ---------- Menu, theme, export ----------

function toggleMenu(open = $("menu").hidden) {
  $("menu").hidden = !open;
  $("menu-btn").setAttribute("aria-expanded", String(open));
  if (open) $("menu").querySelector("button:not([hidden])")?.focus();
}
const closeMenu = () => toggleMenu(false);

function exportCalendar() {
  closeMenu();
  const dated = state.events.filter((ev) => ev.date); // Someday items have no date to export
  if (!dated.length) { showToast("No dated events to export yet"); return; }
  downloadICS(dated, state.categories);
  showToast(`Exported ${plural(dated.length, "event")}. Import the file in Google or Apple Calendar.`);
}

// Auto follows the device's light/dark setting; Light/Dark override it on this device.
function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  $("menu-theme").textContent = `Theme: ${{ auto: "Auto (matches device)", light: "Light", dark: "Dark" }[theme]}`;
}

function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(loadPref(THEME_KEY, THEMES, "auto")) + 1) % THEMES.length];
  savePref(THEME_KEY, next);
  applyTheme(next);
}

function setShowHolidays(show) {
  state.showHolidays = show;
  savePref(HOLIDAYS_KEY, show ? "1" : "0");
  render();
}

// Menu toggles (each device remembers its own choice).
function updateMenuLabels() {
  $("menu-compact").textContent = `Compact view: ${state.compact ? "On" : "Off"}`;
  $("menu-weeknums").textContent = `Week numbers: ${state.weekNumbers ? "On" : "Off"}`;
}

function toggleCompact() {
  state.compact = !state.compact;
  savePref(COMPACT_KEY, state.compact ? "1" : "0");
  updateMenuLabels();
  render();
}

function toggleWeekNumbers() {
  state.weekNumbers = !state.weekNumbers;
  savePref(WEEK_NUMBERS_KEY, state.weekNumbers ? "1" : "0");
  updateMenuLabels();
  render();
}

// ---------- Print ----------
// Print preview shows the current view in a light, ink-friendly layout with every
// event listed (no "+N more"), then Print opens the browser's print dialog.
// Printing with Ctrl+P / ⌘P uses the same layout.

function openPrintPreview() {
  closeMenu();
  if (state.selected) closePanel();
  if (state.somedayOpen) closeSomeday();
  state.printMode = true;
  $("print-bar").hidden = false;
  render();
  window.scrollTo(0, 0);
  $("print-go").focus();
}

function closePrintPreview() {
  state.printMode = false;
  $("print-bar").hidden = true;
  render();
}

let printedFromShortcut = false;
window.addEventListener("beforeprint", () => {
  if (state.printMode) return;
  printedFromShortcut = true;
  state.printMode = true;
  $("print-bar").hidden = false; // so the title prints at the top
  render();
});
window.addEventListener("afterprint", () => {
  if (!printedFromShortcut) return;
  printedFromShortcut = false;
  state.printMode = false;
  $("print-bar").hidden = true;
  render();
});

// ---------- Navigation ----------

// ‹ ›: Month moves a month; Week and Agenda move a week; Year moves a year
// (Jan–Dec) or slides one month (12- and 4-month layouts).
function step(dir) {
  if (state.view === "week" || state.view === "agenda") {
    state.focus = addDays(state.focus, dir * 7);
    const d = parseKey(state.focus);
    state.year = d.getFullYear();
    state.month = d.getMonth();
  } else if (state.view === "year" && state.yearMode === "calendar") {
    state.year += dir;
  } else {
    const d = new Date(state.year, state.month + dir, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
  }
  render();
}

function goToday() {
  const t = new Date();
  state.year = t.getFullYear();
  state.month = t.getMonth();
  state.focus = todayKey();
  state.agendaDays = AGENDA_STEP_DAYS;
  render();
}

function setView(view) {
  const from = state.view;
  // Carry the date you're looking at over to the new view.
  if ((view === "week" || view === "agenda") && (from === "month" || from === "year")) {
    const t = todayKey();
    const first = keyOf(state.year, state.month, 1);
    const inMonth = t.startsWith(first.slice(0, 8));
    state.focus = state.selected ?? (inMonth || from === "year" ? t : first);
    if (view === "agenda") state.agendaDays = AGENDA_STEP_DAYS;
  } else if ((view === "month" || view === "year") && (from === "week" || from === "agenda")) {
    const d = parseKey(state.focus);
    state.year = d.getFullYear();
    state.month = d.getMonth();
  }
  state.view = view;
  savePref(VIEW_KEY, view);
  render();
}

// ---------- Auth / mode ----------

function setAuth(user) {
  const signedOut = isConfigured && !user;
  $("signin").hidden = !signedOut;
  $("calendar").hidden = signedOut;
  $("fab").hidden = signedOut;
  document.querySelector(".topbar").classList.toggle("locked", signedOut);
  $("demo-banner").hidden = !user?.demo;
  $("menu-account").hidden = !user || user.demo;
  if (user && !user.demo) $("menu-account").textContent = user.email ? `Sign out (${user.email})` : "Sign out";
  if (signedOut) { closePanel(); closeSomeday(); }
}

// ---------- Wiring ----------

function wire() {
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("today").onclick = goToday;
  for (const v of VIEWS) $(`view-${v}`).onclick = () => setView(v);
  applyTheme(loadPref(THEME_KEY, THEMES, "auto"));

  $("panel-close").onclick = closePanel;
  $("backdrop").onclick = () => { if (state.somedayOpen) closeSomeday(); else closePanel(); };
  $("fab").onclick = () => openEventForm(state.somedayOpen ? { someday: true } : {});

  // Someday list
  $("someday-btn").onclick = () => (state.somedayOpen ? closeSomeday() : openSomeday());
  $("someday-close").onclick = closeSomeday;
  $("someday-more").onclick = () => openEventForm({ someday: true });
  $("someday-add").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("someday-input");
    const title = input.value;
    input.value = "";
    await addSomeday(title);
  };
  attachSuggestions($("someday-input"), (s) => { $("someday-input").value = s.title; });
  attachSuggestions($("panel-input"), (s) => { $("panel-input").value = s.title; });

  // Print preview
  $("print-go").onclick = () => window.print();
  $("print-close").onclick = closePrintPreview;
  $("quick-add").addEventListener("click", (e) => { if (e.target === $("quick-add")) closeEventForm(); });

  $("search-btn").onclick = openSearch;
  $("search-close").onclick = closeSearch;
  $("search-input").addEventListener("input", (e) => renderSearch(e.target.value));
  $("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("search-results").querySelector(".search-hit")?.click(); }
  });
  $("search").addEventListener("click", (e) => { if (e.target === $("search")) closeSearch(); });
  $("search").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeSearch(); } });

  $("menu-btn").onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  $("menu-categories").onclick = () => openCategories();
  $("menu-export").onclick = exportCalendar;
  $("menu-theme").onclick = cycleTheme;
  $("menu-compact").onclick = toggleCompact;
  $("menu-weeknums").onclick = toggleWeekNumbers;
  $("menu-print").onclick = openPrintPreview;
  updateMenuLabels();
  $("menu-account").onclick = () => { closeMenu(); run(() => state.store.signOut()); };
  document.addEventListener("click", (e) => { if (!$("menu").hidden && !e.target.closest(".menu-wrap")) closeMenu(); });

  $("cats-add").onclick = () => {
    addCategoryRow();
    renderCategoryRows();
    $("cats-list").querySelector("li:last-child .cat-name")?.focus();
  };
  $("cats-cancel").onclick = closeCategories;
  $("cats-form").onsubmit = (e) => { e.preventDefault(); saveCategories(); };
  $("cats").addEventListener("click", (e) => { if (e.target === $("cats")) closeCategories(); });
  $("cats").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeCategories(); } });

  $("signin-btn").onclick = () => run(() => state.store.signIn());

  $("panel-add").onsubmit = async (e) => {
    e.preventDefault();
    const input = $("panel-input");
    const title = input.value;
    input.value = "";
    await addQuick(title, state.selected);
  };
  $("panel-multi").onclick = () => openEventForm({ start: state.selected });
  $("panel-order-reset").onclick = () => run(() => state.store.setDayOrder(state.selected, null));
  $("panel-repeat-show").onclick = () => setHideRepeating(false);

  const modalOpen = () => !$("quick-add").hidden || !$("search").hidden || !$("cats").hidden || !$("choice").hidden;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("menu").hidden) { closeMenu(); $("menu-btn").focus(); return; }
    if (e.target.closest("input, textarea, select, .modal") || modalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" && state.printMode) closePrintPreview();
    else if (e.key === "Escape" && state.somedayOpen) closeSomeday();
    else if (e.key === "Escape" && state.selected) closePanel();
    else if (e.key === "s") { e.preventDefault(); state.somedayOpen ? closeSomeday() : openSomeday(); }
    else if (e.key === "p") openPrintPreview();
    else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "t") goToday();
    else if (e.key === "m") setView("month");
    else if (e.key === "w") setView("week");
    else if (e.key === "y") setView("year");
    else if (e.key === "a") setView("agenda");
    else if (e.key === "/") { e.preventDefault(); openSearch(); }
    else if (e.key === "n" && !$("fab").hidden) { e.preventDefault(); openEventForm(); }
  });

  // Swipe left/right on the calendar to go back/forward.
  let touch = null;
  const cal = $("calendar");
  cal.addEventListener("touchstart", (e) => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  cal.addEventListener("touchend", (e) => {
    if (!touch || state.selected || state.somedayOpen || state.printMode || drag.suppressClick || drag.active
        || move.suppressClick || move.active) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Week view switches between columns and rows with the screen width.
  matchMedia("(min-width: 720px)").addEventListener?.("change", () => { if (state.view === "week") render(); });

  // Refresh "today" when coming back to the app after midnight.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
}

wire();
render();
initStore({
  onEvents: (events) => { state.events = events; render(); },
  onOrders: (orders) => { state.dayOrders = orders; render(); },
  onSettings: (settings) => {
    state.categories = Array.isArray(settings.categories) ? settings.categories : [];
    render();
  },
  onAuth: setAuth,
  onError: (err) => showToast(friendlyError(err)),
}).then((store) => { state.store = store; }, (err) => {
  console.error(err);
  showToast("Couldn't connect. Check your internet connection and reload.");
});
