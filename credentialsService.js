// credentialsService.js — the ONE place the app reads/writes credentials (Pillar 2).
import { supabase, currentUserId } from './supabaseClient';

// Registers we can auto-verify against a live API. Everything else (driver's licence, HRWL,
// insurance, trade licences) has NO free register check — those take the photo-evidence interim.
export const WIRED_REGISTERS = ['wc', 'trades'];
export function isAutoVerifiable(type) {
  return !!type && WIRED_REGISTERS.includes(type.register);
}

// Private, owner-only bucket for photos of credentials that can't be auto-verified.
// A client can NEVER read this — it's the worker's ID. See migration 0056.
const EVIDENCE_BUCKET = 'credential-evidence';

let _typesCache = null;

// catalog of all credential types (reference data)
export async function listCredentialTypes() {
  if (_typesCache) return _typesCache;
  const { data, error } = await supabase
    .from('credential_types')
    .select('id, name, tier, renews_years, register_url, sort, needs_provider, self_declared, expiry_rule, requires_card_no, register')
    .order('sort');
  if (error) throw error;
  _typesCache = data || [];
  return _typesCache;
}

// the current operator's held credentials
export async function listMyCredentials() {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in — please log in again.');
  const { data, error } = await supabase
    .from('operator_credentials')
    .select('id, credential_id, number, card_number, issued_at, expires_at, state, status, evidence_url, verified_at, provider')
    .eq('operator_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// add / update one of the operator's credentials (self-declared -> unverified).
// `provider` is used by cover that has an issuer (e.g. public-liability insurance); null otherwise.
export async function addMyCredential({ credential_id, number, card_number, expires_at, state, provider }) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in — please log in again.');
  const { error } = await supabase
    .from('operator_credentials')
    .upsert(
      {
        operator_id: uid,
        credential_id,
        number: (number && number.trim()) ? number.trim() : null,
        card_number: (card_number && card_number.trim()) ? card_number.trim() : null,
        expires_at: expires_at || null,
        state: (state && state.trim()) ? state.trim() : null,
        provider: (provider && provider.trim()) ? provider.trim() : null,
        status: 'unverified',
      },
      { onConflict: 'operator_id,credential_id' }
    );
  if (error) throw error;
}

export async function removeMyCredential(id) {
  const { error } = await supabase.from('operator_credentials').delete().eq('id', id);
  if (error) throw error;
}

// call the verify-credential Edge Function to auto-verify against the NSW register
export async function verifyMyCredential(id) {
  const { data, error } = await supabase.functions.invoke('verify-credential', {
    body: { credential_id: id },
  });
  if (error) {
    // functions.invoke hides the response body on non-2xx — dig it out for a real message
    let detail = error.message || String(error);
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body && (body.error || body.detail)) detail = body.error || body.detail;
      }
    } catch (_) {}
    throw new Error(detail);
  }
  return data; // { status: 'verified' | 'review', detail?: string }
}

// ── Photo evidence ("ID on file") — the honest interim where there's no free register API ──────
// The worker uploads a photo of the credential (e.g. driver's licence). It lands the credential
// 'review' — NEVER 'verified'. Only an admin (verify_credential) can verify, after eyeballing the
// image. The accept-gate ignores 'review' (it needs status='verified'), so nothing unlocks by
// uploading. Storage is PRIVATE and owner-only (path = {operator_id}/{credential_id}.jpg).

// Upload the photo to the private bucket. Stable path per credential → a re-take overwrites the
// old image (no pile-up / no image history to leak). Returns the stored path.
export async function uploadCredentialEvidence(credentialId, fileUri) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in — please log in again.');
  const path = `${uid}/${credentialId}.jpg`;
  const res = await fetch(fileUri);
  const blob = await res.blob();
  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}

// Attach the uploaded photo to the credential and mark it 'review'. Honest: a photo on file is not
// a check — it's a submission for manual review. Scoped to the caller's own credential row (RLS too).
export async function setCredentialEvidence(credentialId, path) {
  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in — please log in again.');
  const { error } = await supabase
    .from('operator_credentials')
    .update({ evidence_url: path, status: 'review' })
    .eq('operator_id', uid)
    .eq('credential_id', credentialId);
  if (error) throw error;
}

// Signed URL so the OWNER can see the photo they uploaded (bucket is private). Never breaks the UI.
export async function credentialEvidenceUrl(path, expiresSec = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, expiresSec);
  if (error) return null;
  return data?.signedUrl || null;
}

// what a given trade requires (to show on jobs + profile)
export async function requirementsForTrade(tradeId) {
  if (!tradeId) return [];
  const { data, error } = await supabase
    .from('trade_requirements')
    .select('credential_id, requirement, credential:credential_types ( name, tier )')
    .eq('trade_id', tradeId);
  if (error) throw error;
  return data || [];
}

/**
 * Readiness per trade: for each trade_id, is the operator ELIGIBLE to accept
 * (holds every REQUIRED credential, verified and unexpired)?
 * Mirrors the server-side accept-gate exactly, so Home never lies about eligibility.
 * Returns: { [trade_id]: { ready: boolean, missing: [names] } }
 */
export async function readinessForTrades(tradeIds) {
  const ids = (tradeIds || []).filter(Boolean);
  if (ids.length === 0) return {};

  const uid = await currentUserId();
  if (!uid) throw new Error('Not signed in — please log in again.');

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: reqs, error: rErr }, { data: creds, error: cErr }] = await Promise.all([
    supabase
      .from('trade_requirements')
      .select('trade_id, credential_id, requirement, credential:credential_types ( name )')
      .in('trade_id', ids)
      .eq('requirement', 'required'),
    supabase
      .from('operator_credentials')
      .select('credential_id, status, expires_at')
      .eq('operator_id', uid)
      .eq('status', 'verified'),
  ]);
  if (rErr) throw rErr;
  if (cErr) throw cErr;

  // set of credential ids I hold verified + unexpired
  const held = new Set(
    (creds || [])
      .filter((c) => !c.expires_at || c.expires_at >= today)
      .map((c) => c.credential_id)
  );

  const out = {};
  ids.forEach((t) => { out[t] = { ready: true, missing: [] }; });
  (reqs || []).forEach((r) => {
    if (!held.has(r.credential_id)) {
      out[r.trade_id].ready = false;
      out[r.trade_id].missing.push(r.credential?.name || r.credential_id);
    }
  });
  return out;
}

// Verified, unexpired credentials for a given operator — for client-facing trust display
// (e.g. "this worker holds: White Card, Traffic Blue Card" on the review-before-approve
// screen). Returns just the names. Requires RLS to permit a client to read the verified
// credentials of an operator assigned to their job (see B4 RLS note).
// The tickets a worker's chosen trades REQUIRE — deduped across trades, each tagged with whether the
// worker already holds it (and whether it's verified/unexpired). Drives the "tailored tickets" UI:
// instead of the whole catalogue, show exactly what THIS worker needs for the work they picked.
export async function requiredTicketsForTrades(tradeIds) {
  const ids = (tradeIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  const uid = await currentUserId();
  if (!uid) return [];
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: reqs }, { data: creds }] = await Promise.all([
    supabase
      .from('trade_requirements')
      .select('credential_id, requirement, credential:credential_types ( name, tier )')
      .in('trade_id', ids)
      .eq('requirement', 'required'),
    supabase
      .from('operator_credentials')
      .select('credential_id, status, expires_at')
      .eq('operator_id', uid),
  ]);
  const state = {};
  (creds || []).forEach((c) => { state[c.credential_id] = c; });
  const byId = {};
  (reqs || []).forEach((r) => {
    if (byId[r.credential_id]) return;
    const c = state[r.credential_id];
    const verified = !!c && c.status === 'verified' && (!c.expires_at || c.expires_at >= today);
    byId[r.credential_id] = {
      credential_id: r.credential_id,
      name: r.credential?.name || r.credential_id,
      tier: r.credential?.tier || null,
      held: !!c,
      verified,
      status: c?.status || null,
    };
  });
  return Object.values(byId);
}

export async function verifiedCredentialsFor(operatorId) {
  if (!operatorId) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('operator_credentials')
    .select('credential_id, expires_at, credential:credential_types ( name )')
    .eq('operator_id', operatorId)
    .eq('status', 'verified');
  if (error) return [];  // never break the UI on a read failure
  return (data || [])
    .filter((c) => !c.expires_at || c.expires_at >= today)
    .map((c) => c.credential?.name || c.credential_id);
}
