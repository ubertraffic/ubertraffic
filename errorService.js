// errorService.js
// ---------------------------------------------------------------------------
// Observability for the Snack/Expo client (CLAUDE.md rule 3). Until we move to
// EAS builds and can run Sentry, THIS is our crash reporting: it funnels caught
// errors that would otherwise vanish (49 silent `catch (_) {}` blocks) into the
// error_log table so we can SEE what broke — what, where, for whom, when.
//
// Design rules honoured:
//   * Fire-and-forget: logging must NEVER throw or block. A failed log is a
//     no-op — observability can't be allowed to break the thing it observes.
//   * Redaction (rule 3): we NEVER send secrets or PII. Messages are scrubbed
//     for tokens/keys/emails/phones before they leave the device, and meta is
//     whitelisted — only explicitly-passed, non-sensitive keys go up.
//   * Severity separates signal from noise: 'error' = a real failure a user
//     hit; 'warn' = degraded but recovered; 'info' = expected/polling hiccup.
//   * Rate-limited: polling loops (every few seconds) must not flood the table.
// ---------------------------------------------------------------------------

import { supabase } from './supabaseClient';

// ---- redaction --------------------------------------------------------------
// Strip anything that looks like a secret or PII from a free-text message.
function redact(text) {
  if (!text) return '';
  let s = String(text);
  // JWTs / bearer tokens (eyJ… or long dotted base64)
  s = s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/g, '[token]');
  s = s.replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]');
  // API-key-ish patterns (sk_..., service_role, sb-... , long hex/base64 runs)
  s = s.replace(/\b(sk|pk|rk)_[A-Za-z0-9]{8,}/g, '[key]');
  s = s.replace(/service_role[A-Za-z0-9._-]*/gi, '[service_role]');
  s = s.replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hex]');
  // emails and phone numbers (PII)
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  s = s.replace(/\+?\d[\d\s()-]{7,}\d/g, '[phone]');
  // cap length so a giant payload can't be dumped into the log
  return s.slice(0, 500);
}

// meta must be a small, flat, non-sensitive object. We whitelist primitive
// values only and drop anything that smells sensitive by key name.
const SENSITIVE_KEY = /(token|key|secret|password|auth|email|phone|abn|ssn|card|jwt|session)/i;
function cleanMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  let n = 0;
  for (const k of Object.keys(meta)) {
    if (n >= 12) break;                    // cap breadth
    if (SENSITIVE_KEY.test(k)) continue;   // drop sensitive keys entirely
    const v = meta[k];
    if (v == null) continue;
    if (typeof v === 'string') out[k] = redact(v).slice(0, 120);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    // objects/arrays are skipped — keep meta flat and small
    n++;
  }
  return out;
}

// ---- rate limiting ----------------------------------------------------------
// Same context + severity fires at most once per window, so a polling loop that
// errors every few seconds records ONE row per window instead of hundreds.
const WINDOW_MS = 60 * 1000;
const lastSent = new Map(); // key -> timestamp
function throttled(key) {
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < WINDOW_MS) return true;
  lastSent.set(key, now);
  return false;
}

// ---- the one function everything calls -------------------------------------
// logError(context, error, { severity, correlationId, meta, appContext })
//   context       — WHERE it happened, e.g. 'accept', 'refresh:dispatches'
//   error         — the caught Error (or a string)
//   severity      — 'error' (default) | 'warn' | 'info'
//   correlationId — request/dispatch/assignment id, if known (ties to lifecycle)
//   meta          — small, non-sensitive extras (whitelisted + redacted)
//   appContext    — 'operator' | 'client' | undefined
export async function logError(context, error, opts = {}) {
  try {
    const severity = ['error', 'warn', 'info'].includes(opts.severity) ? opts.severity : 'error';
    const key = `${context}|${severity}`;
    // 'info' (polling noise) is always throttled; 'error' is throttled too so a
    // rapid retry loop can't spam, but the window is short enough to catch bursts.
    if (throttled(key)) return;

    const rawMsg = error && error.message ? error.message : String(error || 'unknown');
    const row = {
      context: String(context || 'unknown').slice(0, 120),
      message: redact(rawMsg),
      severity,
      correlation_id: opts.correlationId ? String(opts.correlationId).slice(0, 64) : null,
      meta: cleanMeta(opts.meta),
      app_context: opts.appContext === 'operator' || opts.appContext === 'client' ? opts.appContext : null,
    };

    // user_id must be set for the RLS insert policy to accept the row.
    const { data: u } = await supabase.auth.getUser();
    if (!u || !u.user) return;             // not signed in → nothing to attribute; skip
    row.user_id = u.user.id;

    // fire-and-forget: we do NOT await-throw. If the insert fails, swallow it —
    // observability must never break the app it's watching.
    await supabase.from('error_log').insert(row);
  } catch (_) {
    // absolutely never let logging throw
  }
}

// Convenience wrappers for readability at call sites.
export const logWarn = (context, error, opts = {}) => logError(context, error, { ...opts, severity: 'warn' });
export const logInfo = (context, error, opts = {}) => logError(context, error, { ...opts, severity: 'info' });
