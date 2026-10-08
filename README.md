# My Calendar

A personal planner and to-do calendar that works on your phone and computer and keeps your events in sync.

### Views (tabs at the top)
- **Month**: days with one event get a light highlight. Days with several get a stronger highlight plus a count badge. Multi-day events show as one banner per week with the name written once.
- **Week**: on a computer, the week as seven tall columns showing every event. On a phone, the seven days as rows. ‹ › move a week.
- **Year**: three layouts (switch at the top of Year view; each device remembers its choice):
  - **Jan–Dec**: the calendar year. ‹ › change the year.
  - **12 months**: starts at the current month and runs a year ahead.
  - **4 months**: last month, this month and the next two, with each month's events listed underneath.
  - Months with events are highlighted (stronger = busier), and the current month is outlined.
- **Agenda**: Today, Tomorrow and the rest of the next two weeks as a list. **Show 2 more weeks** extends it. Past days aren't listed, and unfinished items don't carry over.

### Events
- **Add**: tap a day and type in its panel, or use **+** for the full form (dates, category, repeat). A title that starts with a time (`3pm Dentist`, `9:30am Standup`, `14:00 Call`) shows the time as a label and sorts by it.
- **Suggestions from earlier events**: as you type a title, titles you've used before are suggested (e.g. type `patel` to get *2pm Dr. Patel*). Pick one (tap it, or ↑/↓ and Enter) to fill in the title **and its category**, which is handy for follow-up appointments. Typing a past title exactly also reuses its category.
- **Multi-day**: set a later **To** date (it starts out the same as **From**), or **drag across days** (on a phone: press and hold a day, then drag).
- **Repeating**: in the form, choose **Repeat**: every day, **every weekday (Mon–Fri)**, every week (pick the days), every month or every year, every N days/weeks/…, with an optional **Ends** date. Editing or deleting one asks **Just this one** or **All events**. Dragging a repeating event moves only that date. If they crowd the calendar, tap **↻ Repeating** in the **Show:** row under the calendar to hide all repeating events (each device remembers this; search and export still include them, and a day's panel tells you how many are hidden).
- **Done**: tap the **✓ circle** on an event (day panel, Week view, Agenda) to mark it done; it fades and is struck through. Tap again to undo. Each date of a repeating event is marked separately.
- **Someday**: to-dos that need doing but have no date yet. Open the list with **📥** in the top bar (or `S`); the badge counts what's left. Add items there (or tick **No date yet** in the event form, which also moves an existing event off the calendar). When you're ready, drag an item by its **⋮⋮** onto a day (the list slides out of the way while you drag) or tap its 📅 to pick a date. Someday items show up in search but aren't exported.
- **Categories**: you make your own (there are none to start with). Create them in the event form (**Category → + New category…**, which then selects it for that event) or in **⋯ → Categories…**, where you can also rename them, choose their color (tap the color dot to pick from 8 named colors; a gray dot marks colors already in use), or remove them. Each has a name and a short tag (up to 3 characters, or an emoji) shown in front of event titles. The event keeps its own color, so events on the same day stay distinct. Use the **Show:** chips under the calendar to hide or show categories on this device.
- **Your own order**: in a day's panel, drag a card by its **⋮⋮ grip** to put that day's events in any order (or focus the grip and use ↑/↓). **Reset to automatic** brings back the automatic order (multi-day, then by time, then A–Z, done items last).
- **Move**: drag an event onto another day (on a phone, press and hold it first), or drag a card from the day panel onto a day. While dragging, hold it over the **‹ / › strips** at the screen edges to flip to another month or week. Every move has **Undo**.
- **Search**: **🔍** (or `/`) searches all events by title or category, and shows the next date of repeating ones.
- **Print**: **⋯ → Print preview…** (or `P`) shows the current view in a light, ink-friendly layout with every event written out (no "+N more"), then **Print**. Choose Landscape for Month and Week. Printing with Ctrl+P / ⌘P uses the same layout.
- **Export**: **⋯ → Export to Google / Apple Calendar (.ics)** downloads all events (with repeats and categories) as a file you can import. It's a one-time copy, not a live sync.

### Also
- **School holidays** show as green stripes with the holiday name. They're the Nevada state holidays NSHE schools (UNLV, CSN, UNR) close for: New Year's Day, MLK Day, Presidents' Day, Memorial Day, Juneteenth, Independence Day, Labor Day, Nevada Day, Veterans Day, Thanksgiving, Family Day and Christmas. Holidays on a weekend move to the nearest weekday, the dates are worked out for any year (see [`holidays.js`](holidays.js)), and they don't count toward your event badges. Turn them off with the checkbox under the calendar.
- **Theme**: **⋯ → Theme** cycles Auto → Light → Dark. Auto follows your device's setting.
- **Week numbers**: ISO week numbers sit in the left margin of Month view and in the Week view title (e.g. *Wk 41*). Turn them off in **⋯ → Week numbers**.
- **Compact view**: **⋯ → Compact view** tightens cells and text so more fits on screen (and shows up to 3 events per day in Month view). Each device remembers its choice.
- **Shortcuts on a computer**: `←` / `→` back/forward, `T` today, `M` / `W` / `Y` / `A` switch views, `N` new event, `S` Someday list, `/` search, `P` print preview, `Esc` close.

It's plain HTML/CSS/JS hosted free on **GitHub Pages**, with events stored in **Firebase** (Google's free tier). It doesn't depend on Claude.

**Works on:** iPhone/iPad with iOS 14.5 or newer, Chrome/Edge 89+, Firefox 88+, and Samsung Internet 15+ (roughly any phone or browser updated since 2021).

---

## Try it locally (demo mode)

Until you complete the Firebase setup, the app runs in **demo mode**, which saves events only in the current browser.

```bash
python -m http.server 8123
```

Then open http://localhost:8123. Opening `index.html` by double-clicking won't work; it needs to be served this way.

---

## One-time setup (~10 minutes)

### 1. Create a Firebase project
1. Go to https://console.firebase.google.com and sign in with the Google account that should **own** the project.
2. Click **Create a project**, give it a name (e.g. `my-calendar`), and turn off Google Analytics (it isn't needed).
3. Stay on the free **Spark** plan. Don't upgrade to Blaze; staying on Spark means you can never be charged.

### 2. Turn on Google sign-in
1. Go to **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable **Google**, choose a support email, and click Save.

### 3. Create the database and lock it down
1. Go to **Build → Firestore Database → Create database**. Pick a location near you (e.g. `us-west`) and choose **Start in production mode**.
2. Open the **Rules** tab and replace everything with the contents of [`firestore.rules`](firestore.rules). Click **Publish**.

> ⚠️ Never choose "test mode". It lets anyone on the internet read and change your data.

### 4. Connect the app to Firebase
1. Go to **Project settings** (gear icon) → **Your apps** → click the **`</>`** (Web) icon. Register the app with any nickname, and leave Firebase Hosting unchecked.
2. Copy the values from the `firebaseConfig` it shows into [`firebase-config.js`](firebase-config.js), replacing the `YOUR_...` placeholders.

These values aren't secret; every Firebase website includes them. Your data is protected by the rules from step 3.

### 5. Publish on GitHub Pages
1. Create a new repository at https://github.com/new (e.g. `calendar`). Free accounts need it to be **Public**. That's fine: only the app's code is public, and your events are stored in Firebase, not in the repo.
2. Upload all the files in this folder. Either drag them into **Add file → Upload files**, or use git:
   ```bash
   git init
   git add .
   git commit -m "My calendar"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/calendar.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Pages**. Set Source to **Deploy from a branch**, Branch to `main` and `/ (root)`, and click Save.
4. After a minute or two, your calendar is live at `https://YOUR-USERNAME.github.io/calendar/`.

### 6. Allow your site to sign in
In Firebase, go to **Authentication → Settings → Authorized domains → Add domain** and add `YOUR-USERNAME.github.io`.

### 7. Put it on your phone
Open your calendar's address on your phone and sign in with Google.
- **iPhone (Safari):** tap Share → **Add to Home Screen**.
- **Android (Chrome):** tap ⋮ → **Add to Home screen**.

Any change you make shows up on your other devices within a second or two.

---

## Moving to a personal account

When you're ready to leave your school account, set the calendar up again from scratch. **Events from the old setup don't carry over**, so the new calendar starts empty.

1. Sign in to Firebase with your **personal** Google account and repeat **steps 1–4** above. This creates a new project, and you paste its values into `firebase-config.js`.
2. Put the code under your personal GitHub, using either option:
   - **Transfer the repo:** in the old repo go to **Settings → General → Danger Zone → Transfer ownership**, then commit the new `firebase-config.js`.
   - **Start a new repo:** upload the files to a new repo on your personal account (step 5).
3. Re-check **Settings → Pages** on the new repo and add the new `YOUR-PERSONAL-USERNAME.github.io` domain in Firebase (step 6). The web address changes when the GitHub account changes.
4. On your phone, remove the old home-screen shortcut and add the new address.
5. Optional cleanup: delete the old Firebase project (**Project settings → General → Delete project**) and the old repo.

---

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page layout |
| `styles.css` | Look and feel, phone + desktop, light + dark |
| `app.js` | Views, forms, dragging, search, categories |
| `store.js` | Saving/syncing events (Firebase, or demo mode) |
| `holidays.js` | Nevada school holiday dates, calculated for any year |
| `recurrence.js` | Repeating-event rules and dates |
| `dates.js` | Date helpers |
| `ics.js` | Export to .ics (Google / Apple Calendar) |
| `firebase-config.js` | **The only file you edit**: your Firebase project settings |
| `firestore.rules` | Database security rules; paste into Firebase (step 3) |
| `manifest.json`, `icon.svg` | Home-screen app name and icon |

## Troubleshooting

- **"This site isn't on Firebase's authorized domains list"**: do step 6.
- **"Not allowed…" when adding events**: the Firestore rules from step 3 weren't published, or you're signed out.
- **Sign-in does nothing on iPhone**: allow pop-ups for the site (Settings → Safari → Block Pop-ups off), or open the calendar in Safari itself rather than inside another app.
- **Still says "Demo mode"**: `firebase-config.js` still has the `YOUR_...` placeholders, or the browser cached the old copy. Do a hard refresh.
