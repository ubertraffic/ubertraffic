// location.js — get the device's GPS, with an honest fallback for Snack/web.
//
// Tries expo-location (real GPS on a phone via Expo Go). If it isn't available
// or permission is denied, returns a dev coordinate and marks source:'fallback'
// so the caller/UI can be honest about it. This lets the geofence be tested
// today without physically moving 300m, without ever silently faking a pass.

let Location = null;
try {
  // Only present when expo-location is installed & the SDK matches.
  Location = require('expo-location');
} catch (_) {
  Location = null;
}

// A dev site location for testing when real GPS isn't available.
// Sydney CBD-ish; override per-test to simulate near/far from a job.
export const DEV_LOCATION = { lat: -33.8688, lng: 151.2093 };

/**
 * Returns { lat, lng, accuracy, source }.
 *   source: 'gps'      — real device location
 *           'fallback' — expo-location unavailable / denied; DEV_LOCATION used
 * Never throws for location reasons; callers get a usable coord + honest source.
 */
export async function getPosition() {
  if (Location && Location.requestForegroundPermissionsAsync) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy?.Balanced ?? 3,
        });
        return {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          source: 'gps',
        };
      }
    } catch (_) {
      // fall through to fallback
    }
  }
  return { ...DEV_LOCATION, accuracy: null, source: 'fallback' };
}
