// dateFormat.js — day/month/year entry (Australian). Users just type digits; we auto-insert the
// slashes as they go (DD/MM/YYYY). Storage is always ISO (YYYY-MM-DD) for the DB/date columns.

// Format raw keystrokes into DD/MM/YYYY as the user types.
export function formatDMY(s) {
  const d = String(s || '').replace(/\D/g, '').slice(0, 8); // DDMMYYYY
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// DD/MM/YYYY -> YYYY-MM-DD, or null if not a real date (rejects 31/02 etc.).
export function dmyToISO(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const dt = new Date(iso + 'T00:00:00');
  if (isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== +yyyy || dt.getUTCMonth() + 1 !== +mm || dt.getUTCDate() !== +dd) return null;
  return iso;
}

// YYYY-MM-DD -> DD/MM/YYYY for display (leaves anything else untouched).
export function isoToDMY(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
}
