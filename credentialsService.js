// credentialsService.js — the ONE place the app reads/writes credentials (Pillar 2).
import { supabase } from './supabaseClient';

let _typesCache = null;

// catalog of all credential types (reference data)
export async function listCredentialTypes() {
  if (_typesCache) return _typesCache;
  const { data, error } = await supabase
    .from('credential_types')
    .select('id, name, tier, renews_years, register_url, sort, needs_provider, self_declared, expiry_rule, requires_card_no')
    .order('sort');
  if (error) throw error;
  _typesCache = data || [];
  return _typesCache;
}

// the current operator's held credentials
export async function listMyCredentials() {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in — please log in again.');
  const { data, error } = await supabase
    .from('operator_credentials')
    .select('id, credential_id, number, card_number, issued_at, expires_at, state, status, evidence_url, verified_at, provider')
    .eq('operator_id', u.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// add / update one of the operator's credentials (self-declared -> unverified).
// `provider` is used by cover that has an issuer (e.g. public-liability insurance); null otherwise.
export async function addMyCredential({ credential_id, number, card_number, expires_at, state, provider }) {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in — please log in again.');
  const { error } = await supabase
    .from('operator_credentials')
    .upsert(
      {
        operator_id: u.user.id,
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

  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in — please log in again.');

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
      .eq('operator_id', u.user.id)
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
