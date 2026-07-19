// geocodeService.js — address search + reverse geocode. Returns { label, lat, lng }.
//
// Uses MapTiler Geocoding (the same free key the map already uses). Compared to the public Nominatim
// endpoint this gives proper AUTOCOMPLETE and street-NUMBER-level results ("42 Smith St, Alexandria")
// on Australian addresses, with a generous free tier — no new account, no server. The provider is
// wrapped behind this one service so it can be swapped again later without touching the UI.
//
// The key is a client-side map key (already public in the map tiles URL); restrict it by domain in
// the MapTiler dashboard for production.

import { logWarn } from './errorService';

const MAPTILER_KEY = '4wtbhulnLrfGxXqYgSOp';
const GEO = 'https://api.maptiler.com/geocoding';

const STATE_ABBR = {
  'New South Wales': 'NSW', 'Victoria': 'VIC', 'Queensland': 'QLD', 'South Australia': 'SA',
  'Western Australia': 'WA', 'Tasmania': 'TAS', 'Australian Capital Territory': 'ACT', 'Northern Territory': 'NT',
};

/**
 * Search AU addresses (autocomplete-friendly, house-number aware). Returns up to `limit`:
 *   [{ label, lat, lng }]
 * Never throws for "no results" — returns []. Throws only on network failure (caller surfaces gently).
 */
export async function searchAddress(query, limit = 5) {
  const q = (query || '').trim();
  if (q.length < 3) return [];

  const params = new URLSearchParams({
    key: MAPTILER_KEY,
    country: 'au',            // bias to Australia
    autocomplete: 'true',     // partial "42 Smith St…" queries
    limit: String(limit),
    language: 'en',
  });

  const res = await fetch(`${GEO}/${encodeURIComponent(q)}.json?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`geocode_failed_${res.status}`);

  const body = await res.json();
  const features = Array.isArray(body?.features) ? body.features : [];
  return features.map((f) => {
    const c = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : null;
    return c ? { label: f.place_name || f.text, lat: parseFloat(c[1]), lng: parseFloat(c[0]) } : null;
  }).filter((r) => r && Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

// Reverse geocode: coords -> a concise "Suburb, STATE" label (best-effort). Used so "use my current
// location" shows the real place, not a placeholder. Returns a string, or null on failure.
export async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const params = new URLSearchParams({ key: MAPTILER_KEY, limit: '1', language: 'en' });
    const res = await fetch(`${GEO}/${lng},${lat}.json?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const f = (body?.features || [])[0];
    if (!f) return null;
    // build a tidy "locality, STATE" from the feature's context when we can
    let locality = null, region = null;
    (f.context || []).forEach((ctx) => {
      const id = (ctx.id || '').toLowerCase();
      if (!locality && /(place|municipal|subregion|locality|city|town)/.test(id)) locality = ctx.text;
      if (/region/.test(id)) region = ctx.text;
    });
    const st = STATE_ABBR[region] || region;
    if (locality) return st ? `${locality}, ${st}` : locality;
    return (f.place_name || f.text || '').replace(/,?\s*Australia$/i, '') || null;
  } catch (e) { logWarn('reverse_geocode', e); return null; }
}
