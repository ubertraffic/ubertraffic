// screenCache.js — a tiny in-memory cache so tab screens can render INSTANTLY from their
// last-known data on remount, then refresh in the background. This fixes the "blank spinner on
// every tab switch" caused by screens fully unmounting + refetching cold each time.
//
// Deliberately simple and SAFE:
//   - Module-level (survives React unmount/remount, cleared on full app reload / sign-out).
//   - Per-user keyed, so one account never sees another's cached data.
//   - Cache is a *seed* for instant paint only — every screen still refreshes in the background,
//     and the fresh result always overwrites the cache. Never a substitute for a real load.
//
// Usage in a screen:
//   const [mine, setMine] = useState(() => cacheGet('client-requests'));   // instant paint or null
//   const load = useCallback(async () => {
//     try { const d = await fetch(); setMine(d); cacheSet('client-requests', d); }
//     catch { setMine((p) => (p == null ? [] : p)); }
//   }, []);
//
// The key should be stable per screen. Call cacheClearAll() on sign-out.

let _userId = null;
const _store = new Map();   // key -> value

// Bind the cache to a user. If the user changes, wipe everything (no cross-account leakage).
export function cacheBindUser(userId) {
  if (userId !== _userId) {
    _store.clear();
    _userId = userId || null;
  }
}

export function cacheGet(key) {
  return _store.has(key) ? _store.get(key) : null;
}

export function cacheSet(key, value) {
  // never cache null/undefined — that would defeat the instant-paint (a null seed still spins)
  if (value == null) return;
  _store.set(key, value);
}

export function cacheClear(key) {
  _store.delete(key);
}

export function cacheClearAll() {
  _store.clear();
  _userId = null;
}
