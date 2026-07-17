// accountService.js
// The identity + capability layer (Phase A1). Separates three concepts that used
// to be tangled together:
//   - account_type : declared primary identity ('worker' | 'company'), stable
//   - can_work / can_hire : capabilities, each earned via its own verification
//   - the UI "which side am I viewing" toggle lives in the app, not here
//
// Screens call these; no direct supabase in the UI (CLAUDE.md §2).
import { supabase } from './supabaseClient';

// Read the current user's identity + capability snapshot.
export async function getMyAccount() {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in.');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, account_type, can_work, can_hire, worker_verify_status, company_verify_status')
    .eq('id', u.user.id)
    .single();
  if (error) throw error;
  return data;
}

// Declare primary identity at signup. Only sets account_type — capabilities are
// still earned separately via verification. Idempotent-ish: allowed to set once;
// changing it later is a deliberate, gated action (not a free toggle).
export async function setAccountType(type) {
  if (type !== 'worker' && type !== 'company') throw new Error('Invalid account type.');
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ account_type: type })
    .eq('id', u.user.id);
  if (error) throw error;
}

// Capability helpers — the app gates on these, but they are the CLIENT-SIDE
// reflection of server truth. The real enforcement is server-side (RLS + RPC
// validation in later phases). These just drive what the UI offers.
export function capabilities(profile) {
  if (!profile) return { canWork: false, canHire: false, both: false, neither: true };
  const canWork = !!profile.can_work;
  const canHire = !!profile.can_hire;
  return { canWork, canHire, both: canWork && canHire, neither: !canWork && !canHire };
}

// What a given side needs before it's unlocked — drives the "get verified" prompts.
export function sideStatus(profile, side) {
  // side: 'work' | 'hire'
  if (!profile) return { unlocked: false, status: 'none' };
  if (side === 'work') return { unlocked: !!profile.can_work, status: profile.worker_verify_status || 'none' };
  return { unlocked: !!profile.can_hire, status: profile.company_verify_status || 'none' };
}

// ── Verification pipeline (real) ────────────────────────────────────────────
// Submit a credential for review. ALWAYS lands 'pending' server-side — the client cannot
// self-verify (RLS + the submit_credential function enforce this). An admin (or the SafeWork
// API later) approves via verify_credential. This is the honest path that replaced the old
// dev self-grant, which was a security hole (let anyone mark themselves verified).
export async function submitCredential(credentialId, number = null, expiresAt = null) {
  const { data, error } = await supabase.rpc('submit_credential', {
    p_credential_id: credentialId, p_number: number, p_expires_at: expiresAt,
  });
  if (error) throw error;
  return data;
}

// Submit a business ABN for verification. Lands 'pending'; admin/ABR API approves.
export async function submitBusinessAbn(abn) {
  const { data, error } = await supabase.rpc('submit_abn', { p_abn: abn });
  if (error) throw error;
  return data;
}

// ── Worker ABN (sole-trader / contractor) ────────────────────────────────────
// Separate from the hire-side business-ABN gate above. Deterministic format+checksum ONLY,
// client-side (no key needed). Stored as abn_status='valid' meaning "format checked" — this is
// NOT register verification. True "verified against the ABR register" is a deferred, server-side
// step (a free ABR GUID + an Edge Function); it must never be self-granted here. Honest labelling.

export function normalizeAbn(abn) { return String(abn || '').replace(/\D/g, ''); }

// The official ABR ABN validation: 11 digits, subtract 1 from the first, weighted sum mod 89 === 0.
export function abnValid(abn) {
  const d = normalizeAbn(abn);
  if (!/^\d{11}$/.test(d)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = d.split('').map(Number);
  nums[0] -= 1;
  const sum = nums.reduce((s, n, i) => s + n * weights[i], 0);
  return sum % 89 === 0;
}

// Save the worker's own ABN on their profile. Only stores when the checksum passes; status is
// 'valid' (format checked), never 'verified' — that's the later server-side ABR step.
export async function setMyAbn(abn) {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in.');
  const clean = normalizeAbn(abn);
  if (!/^\d{11}$/.test(clean)) throw new Error('An ABN is 11 digits.');
  if (!abnValid(clean)) throw new Error('That ABN doesn’t check out — double-check the number.');
  const { error } = await supabase
    .from('profiles')
    .update({ abn: clean, abn_status: 'valid' })
    .eq('id', u.user.id);
  if (error) throw error;
  return { abn: clean, abn_status: 'valid' };
}

// ── Identity (legal name + DOB) ──────────────────────────────────────────────
// The anchor a register/DVS check must match against. Sensitive PII — collected with a
// clear purpose line, used only for verification, never shown publicly. Stored on the profile;
// if the display full_name isn't set yet, seed it from the legal name so the app still shows a name.
export async function setMyIdentity(legalName, dob) {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in.');
  const name = (legalName || '').trim();
  if (name.length < 2) throw new Error('Enter your full legal name.');
  const d = (dob || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Enter your date of birth as YYYY-MM-DD.');
  const parsed = new Date(d + 'T00:00:00');
  if (isNaN(parsed.getTime()) || parsed > new Date()) throw new Error('Enter a valid date of birth.');
  const patch = { legal_name: name, date_of_birth: d };
  const { data: p } = await supabase.from('profiles').select('full_name').eq('id', u.user.id).maybeSingle();
  if (!p || !p.full_name) patch.full_name = name;   // seed the display name if empty
  const { error } = await supabase.from('profiles').update(patch).eq('id', u.user.id);
  if (error) throw error;
  return { legal_name: name, date_of_birth: d };
}

// ── Public profile (Stage 1) ────────────────────────────────────────────────
// The canonical, public-safe reputation profile for any user. Honest by design:
// verified badges only when real, ratings carry their count, empty history flags is_new.
export async function getPublicProfile(userId) {
  const { data, error } = await supabase.rpc('get_public_profile', { p_user_id: userId });
  if (error) throw error;
  return data;
}

// Reputation extras — the parts of a worker's reputation that ride ON TOP of the star
// rating already in get_public_profile: how many clients would re-hire them, and the tally
// of "good unit" tags. Read via its own RPC and MERGED into the profile client-side, so the
// (unseen) get_public_profile function stays untouched. Returns { rehire_count, tag_counts }.
export async function getReputationExtras(userId) {
  const { data, error } = await supabase.rpc('get_reputation_extras', { p_user_id: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || { rehire_count: 0, tag_counts: {}, vouch_count: 0, vouchers: [] };
}

// Stage 2: owner edits their own headline + bio (length-capped server-side).
export async function updateMyProfileBio(headline, bio) {
  const { error } = await supabase.rpc('update_my_profile_bio', { p_headline: headline, p_bio: bio });
  if (error) throw error;
}
