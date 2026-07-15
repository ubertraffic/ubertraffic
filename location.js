// location.js — get the device's GPS, with an honest fallback for Snack/web.
//
// Tries expo-location (real GPS on a phone via Expo Go). If it isn't available
// or permission is denied, returns a dev coordinate and marks source:'fallback'
// so the caller/UI can be honest about it. This lets the geofence be tested
// today without physically moving 300m, without ever silently faking a pass.
//
// REQUIRES "expo-location" in package.json — without it the require below fails
// and real GPS can NEVER run (always falls back to DEV_LOCATION).

let Location = null;
try {
  // Only present when expo-location is installed & the SDK matches.
  Location = require('expo-location');
} catch (_) {
  Location = null;
}

// A dev site location for testing when real GPS isn't available (Snack web has
// no reliable GPS). Set to Hobartville NSW (Richmond area) — the developer's real
// area — so map/heat/ETA testing reflects a true location, not Sydney CBD.
// On a real phone via Expo Go this is NOT used — real GPS wins (source:'gps').
export const DEV_LOCATION = { lat: -33.6056, lng: 150.7439 };

// Ask for permission once, reuse the result. Returns true if we may use GPS.
let _permAsked = false;
let _permGranted = false;
async function ensurePermission() {
  if (!Location || !Location.requestForegroundPermissionsAsync) return false;
  if (_permAsked) return _permGranted;
  _permAsked = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    _permGranted = status === 'granted';
  } catch (_) {
    _permGranted = false;
  }
  return _permGranted;
}

/**
 * One-shot position. Returns { lat, lng, accuracy, source }.
 *   source: 'gps'      — real device location
 *           'fallback' — expo-location unavailable / denied; DEV_LOCATION used
 * Never throws for location reasons; callers get a usable coord + honest source.
 */
export async function getPosition() {
  if (await ensurePermission()) {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy?.Balanced ?? 3,
      });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
        source: 'gps',
      };
    } catch (_) {
      // fall through to fallback
    }
  }
  return { ...DEV_LOCATION, accuracy: null, source: 'fallback' };
}

/**
 * LIVE position — follows the device as it moves.
 *   watchPosition(onUpdate) -> returns an async "stop" function.
 *   onUpdate is called with { lat, lng, accuracy, source:'gps' } every time the
 *   device moves enough (or every few seconds), so the map can follow in real time.
 *
 * If real GPS isn't available (Snack web / permission denied), it calls onUpdate
 * ONCE with the honest fallback and does not pretend to stream — the caller still
 * gets a usable coord, just not a moving one.
 *
 * Always returns a stop() function so the caller can clean up on unmount.
 */
export async function watchPosition(onUpdate) {
  if (typeof onUpdate !== 'function') return () => {};

  if (await ensurePermission()) {
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy?.Balanced ?? 3,
          timeInterval: 4000,     // at most every 4s
          distanceInterval: 15,   // or when moved ~15m — whichever first
        },
        (pos) => {
          onUpdate({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
            source: 'gps',
          });
        }
      );
      // stop() removes the native subscription — call on unmount.
      return () => { try { sub && sub.remove && sub.remove(); } catch (_) {} };
    } catch (_) {
      // fall through to a single fallback emit
    }
  }

  // No live GPS available — emit the honest fallback once, no streaming.
  onUpdate({ ...DEV_LOCATION, accuracy: null, source: 'fallback' });
  return () => {};
}
