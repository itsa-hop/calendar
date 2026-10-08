// Data layer. One interface, two backends:
//   - Firebase (Google sign-in + Firestore, synced across devices)
//   - Local demo (localStorage, this browser only) while firebase-config.js is unfilled
import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2";
const LOCAL_KEY = "calendar.events.v1";
const LOCAL_ORDERS_KEY = "calendar.dayOrders.v1";
const LOCAL_SETTINGS_KEY = "calendar.settings.v1";

export const isConfigured =
  !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");

function newId() {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// An event is { id, title, date, createdAt } plus optional fields:
//   endDate     "YYYY-MM-DD", multi-day events
//   repeat      repeating rule (see recurrence.js), exceptions: dates skipped
//   done        true when a one-off event is done; doneDates: done occurrences of a repeating one
//   category    id of one of your categories
//   someday     true for a to-do with no date yet (then there's no date/endDate/repeat)
// Passing null (or an empty list) for a field in update() removes it.
const EVENT_FIELDS = ["title", "date", "endDate", "repeat", "exceptions", "done", "doneDates", "category", "someday", "createdAt"];
const isEmpty = (v) => v == null || v === false || v === "" || (Array.isArray(v) && v.length === 0);
function clean(obj) {
  const out = {};
  for (const k of EVENT_FIELDS) if (!isEmpty(obj[k])) out[k] = obj[k];
  return out;
}

// A day order is a list of event ids for a day you've rearranged by hand,
// stored per date ("YYYY-MM-DD" -> [ids]). Days without one use the automatic sort.
// Settings is a small object shared by your devices: { categories: [...] }.

// onEvents(events[]), onOrders({ date: ids[] }) and onSettings(settings) fire on every
// change; onAuth(user|null) fires on sign-in state changes.
export async function initStore(handlers) {
  return isConfigured ? initFirebase(handlers) : initLocal(handlers);
}

function initLocal({ onEvents, onOrders, onSettings, onAuth }) {
  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const read = () => readJson(LOCAL_KEY, []);
  const readOrders = () => readJson(LOCAL_ORDERS_KEY, {});
  const readSettings = () => readJson(LOCAL_SETTINGS_KEY, {});
  const write = (events) => { writeJson(LOCAL_KEY, events); onEvents(events); };

  window.addEventListener("storage", (e) => {
    if (e.key === LOCAL_KEY) onEvents(read());
    if (e.key === LOCAL_ORDERS_KEY) onOrders(readOrders());
    if (e.key === LOCAL_SETTINGS_KEY) onSettings(readSettings());
  });
  onAuth({ demo: true });
  onSettings(readSettings());
  onOrders(readOrders());
  onEvents(read());

  return {
    mode: "local",
    async add(fields) {
      const id = newId();
      write([...read(), { id, ...clean({ ...fields, createdAt: Date.now() }) }]);
      return id;
    },
    async update(id, changes) {
      write(read().map((ev) => (ev.id === id ? { id, ...clean({ ...ev, ...changes }) } : ev)));
    },
    async remove(id) {
      write(read().filter((ev) => ev.id !== id));
    },
    // Put a deleted event back with its original id (used by Undo).
    async restore(ev) {
      write([...read().filter((e) => e.id !== ev.id), { id: ev.id, ...clean(ev) }]);
    },
    // ids = the day's events in your order, or null to go back to automatic.
    async setDayOrder(date, ids) {
      const orders = readOrders();
      if (ids?.length) orders[date] = ids;
      else delete orders[date];
      writeJson(LOCAL_ORDERS_KEY, orders);
      onOrders(orders);
    },
    async setSettings(partial) {
      const settings = { ...readSettings(), ...partial };
      writeJson(LOCAL_SETTINGS_KEY, settings);
      onSettings(settings);
    },
    async signIn() {},
    async signOut() {},
  };
}

async function initFirebase({ onEvents, onOrders, onSettings, onAuth, onError }) {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);

  const app = initializeApp(firebaseConfig);
  const authInst = auth.getAuth(app);
  let db;
  try {
    // Cache data on the device so the calendar opens instantly and works offline.
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }

  let uid = null;
  let unsubscribers = [];
  const col = () => fs.collection(db, "users", uid, "events");
  const orderCol = () => fs.collection(db, "users", uid, "dayOrders");
  const settingsDoc = () => fs.doc(db, "users", uid, "settings", "main");

  auth.getRedirectResult(authInst).catch((err) => onError?.(err));

  auth.onAuthStateChanged(authInst, (user) => {
    unsubscribers.forEach((stop) => stop());
    unsubscribers = [];
    uid = user?.uid ?? null;
    onAuth(user ? { name: user.displayName, email: user.email, photo: user.photoURL } : null);
    if (!user) { onEvents([]); onOrders({}); onSettings({}); return; }
    unsubscribers.push(fs.onSnapshot(
      col(),
      (snap) => onEvents(snap.docs.map((d) => ({ id: d.id, createdAt: 0, ...clean(d.data()) }))),
      (err) => onError?.(err),
    ));
    unsubscribers.push(fs.onSnapshot(
      orderCol(),
      (snap) => onOrders(Object.fromEntries(snap.docs.map((d) => [d.id, d.data().ids ?? []]))),
      (err) => onError?.(err),
    ));
    unsubscribers.push(fs.onSnapshot(
      settingsDoc(),
      (snap) => onSettings(snap.data() ?? {}),
      (err) => onError?.(err),
    ));
  });

  return {
    mode: "firebase",
    async add(fields) {
      const id = newId();
      await fs.setDoc(fs.doc(col(), id), clean({ ...fields, createdAt: Date.now() }));
      return id;
    },
    async update(id, changes) {
      const patch = {};
      for (const [k, v] of Object.entries(changes)) {
        if (EVENT_FIELDS.includes(k)) patch[k] = isEmpty(v) ? fs.deleteField() : v;
      }
      await fs.updateDoc(fs.doc(col(), id), patch);
    },
    async remove(id) {
      await fs.deleteDoc(fs.doc(col(), id));
    },
    async restore(ev) {
      await fs.setDoc(fs.doc(col(), ev.id), clean(ev));
    },
    async setDayOrder(date, ids) {
      const ref = fs.doc(orderCol(), date);
      if (ids?.length) await fs.setDoc(ref, { ids });
      else await fs.deleteDoc(ref);
    },
    async setSettings(partial) {
      await fs.setDoc(settingsDoc(), partial, { merge: true });
    },
    async signIn() {
      const provider = new auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await auth.signInWithPopup(authInst, provider);
      } catch (err) {
        // Mobile browsers often block popups; fall back to a full-page redirect.
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment",
             "auth/cancelled-popup-request"].includes(err.code)) {
          await auth.signInWithRedirect(authInst, provider);
        } else if (err.code !== "auth/popup-closed-by-user") {
          throw err;
        }
      }
    },
    async signOut() {
      await auth.signOut(authInst);
      // Wipe the offline copy of events so nothing is left behind on a shared computer.
      try {
        await fs.terminate(db);
        await fs.clearIndexedDbPersistence(db);
      } catch (err) {
        console.warn("Could not clear offline cache", err);
      }
      location.reload();
    },
  };
}
