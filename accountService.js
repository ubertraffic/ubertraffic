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

// ── Public profile (Stage 1) ────────────────────────────────────────────────
// The canonical, public-safe reputation profile for any user. Honest by design:
// verified badges only when real, ratings carry their count, empty history flags is_new.
export async function getPublicProfile(userId) {
  const { data, error } = await supabase.rpc('get_public_profile', { p_user_id: userId });
  if (error) throw error;
  return data;
}

// Stage 2: owner edits their own headline + bio (length-capped server-side).
export async function updateMyProfileBio(headline, bio) {
  const { error } = await supabase.rpc('update_my_profile_bio', { p_headline: headline, p_bio: bio });
  if (error) throw error;
}
