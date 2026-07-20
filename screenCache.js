// screenCache.js — a tiny cache so tab screens render INSTANTLY from their last-known data instead of
// showing a cold spinner, then refresh in the background. Two layers:
//   1. An in-memory Map for SYNCHRONOUS reads — React needs a value at first render
//      (`useState(() => cacheGet(key))`), so the seed must be available without awaiting.
//   2. A write-through to AsyncStorage so the seed SURVIVES A FULL APP RELOAD. On boot we hydrate the
//      Map from storage (see cacheHydrate) BEFORE the shell mounts, so even a cold start paints from
//      the last session's data rather than spinning.
//
// Safety:
//   - Per-user namespaced in storage, so one account never sees another's data (and hydrate only ever
//     loads the signed-in user's keys).
//   - The cache is a *seed for instant paint only* — every screen still refreshes in the background and
//     overwrites both layers with the fresh result. A stale seed is corrected within ~1s.
//
// Usage in a screen (unchanged):
//   const [mine, setMine] = useState(() => cacheGet('client-requests'));   // instant paint or null
//   const load = useCallback(async () => {
//     try { const d = await fetch(); setMine(d); cacheSet('client-requests', d); }
//     catch { setMine((p) => (p == null ? [] : p)); }
//   }, []);

import AsyncStorage from '@react-native-async-storage/async-storage';

let _userId = null;
const _store = new Map();          // key -> value (synchronous read layer)
const _writeTimers = new Map();    // key -> timeout (debounce persistence)
const PREFIX = 'sc:';              // storage namespace

const storageKey = (userId, key) => `${PREFIX}${userId}:${key}`;

// Bind the cache to a user. If the user changes, wipe the in-memory layer (no cross-account leakage).
// Storage is namespaced per user, so we don't need to touch it here — hydrate loads only this user's.
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
  if (!_userId) return;
  // Debounce the disk write ~500ms per key: a screen may cacheSet several times in a burst
  // (optimistic update → refresh), and only the last value needs to reach storage.
  const existing = _writeTimers.get(key);
  if (existing) clearTimeout(existing);
  const uid = _userId;
  _writeTimers.set(key, setTimeout(() => {
    _writeTimers.delete(key);
    try {
      const json = JSON.stringify(value);
      AsyncStorage.setItem(storageKey(uid, key), json).catch(() => {});
    } catch (_) { /* unserialisable value — skip persistence, memory seed still works */ }
  }, 500));
}

// Load this user's persisted screen data into the in-memory store. Called ONCE on boot, awaited before
// the shell mounts, so a cold start paints from the last session. Best-effort; never throws.
export async function cacheHydrate(userId) {
  if (!userId) return;
  _userId = userId;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = (keys || []).filter((k) => k.startsWith(`${PREFIX}${userId}:`));
    if (!mine.length) return;
    const pairs = await AsyncStorage.multiGet(mine);
    const strip = `${PREFIX}${userId}:`.length;
    for (const [sk, raw] of pairs) {
      if (!raw) continue;
      try { _store.set(sk.slice(strip), JSON.parse(raw)); } catch (_) { /* skip a corrupt entry */ }
    }
  } catch (_) { /* cold paint just falls back to spinners */ }
}

export function cacheClear(key) {
  _store.delete(key);
  const t = _writeTimers.get(key);
  if (t) { clearTimeout(t); _writeTimers.delete(key); }
  if (_userId) { try { AsyncStorage.removeItem(storageKey(_userId, key)).catch(() => {}); } catch (_) {} }
}

// Full wipe — on sign-out. Clears memory synchronously (so the next render is clean immediately) and
// purges persisted keys in the background (fire-and-forget; the caller needn't await).
export function cacheClearAll() {
  _store.clear();
  _writeTimers.forEach((t) => clearTimeout(t));
  _writeTimers.clear();
  _userId = null;
  (async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const mine = (keys || []).filter((k) => k.startsWith(PREFIX));
      if (mine.length) await AsyncStorage.multiRemove(mine);
    } catch (_) { /* best-effort */ }
  })();
}
