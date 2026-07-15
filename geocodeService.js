// geocodeService.js — address search -> { label, lat, lng } via Nominatim (OSM).
//
// Wrapped behind one service so the provider can be swapped (Google/Mapbox) later
// without touching the UI (CLAUDE.md §2). Free public Nominatim has usage limits:
// ~1 req/sec and a real User-Agent — so callers should DEBOUNCE (the UI does).
// TICKET: at scale, self-host Nominatim or move to a keyed provider + rate limit.

import { logWarn } from './errorService';
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Search AU addresses. Returns up to `limit` results:
 *   [{ label, lat, lng }]
 * Never throws for "no results" — returns []. Throws only on network failure,
 * which the caller surfaces gently.
 */
export async function searchAddress(query, limit = 5) {
  const q = (query || '').trim();
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
    countrycodes: 'au',            // bias to Australia
  });

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: {
      // Nominatim policy: identify the app.
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`geocode_failed_${res.status}`);

  const rows = await res.json();
  if (!Array.isArray(rows)) return [];

  return rows.map((r) => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
  })).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

// Reverse geocode: coords -> a human address label (best-effort). Used so
// "use my current location" shows the real place, not a placeholder string.
// Returns a label string, or null on failure (caller keeps the coords regardless).
const REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const params = new URLSearchParams({
      lat: String(lat), lon: String(lng), format: 'json', addressdetails: '1', zoom: '16',
    });
    const res = await fetch(`${REVERSE_ENDPOINT}?${params.toString()}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const r = await res.json();
    if (!r) return null;
    // prefer a concise "suburb, state" if available, else the full display name
    const a = r.address || {};
    const suburb = a.suburb || a.town || a.city || a.village || a.neighbourhood;
    const state = a.state_code || a.state;
    if (suburb) return state ? `${suburb}, ${state}` : suburb;
    return r.display_name || null;
  } catch (e) { logWarn('reverse_geocode', e); return null; }
}
