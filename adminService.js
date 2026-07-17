// adminService.js — the ONLY place the app calls the admin tools. Every function here is a thin
// wrapper over a SECURITY DEFINER RPC that re-checks is_admin() SERVER-SIDE. The UI hiding the panel
// is convenience; the RPC gate is the real security. No service-role key ever touches the client
// (CLAUDE.md crown-jewels rule) — privileged writes happen inside the database functions.
import { supabase } from './supabaseClient';

// Am I an admin? Server truth (checks the admins table, which no user can write to).
export async function amIAdmin() {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;   // never break the app on this — just means "no admin panel"
  return !!data;
}

// Live counts for the overview.
export async function adminOverview() {
  const { data, error } = await supabase.rpc('admin_overview');
  if (error) throw error;
  return data || {};
}

// ── Credential verification queue ────────────────────────────────────────────
export async function adminPendingCredentials() {
  const { data, error } = await supabase.rpc('admin_pending_credentials');
  if (error) throw error;
  return data || [];
}
// approve=true -> verified; approve=false -> back to unverified with an optional note.
export async function adminDecideCredential(rowId, approve, note = null) {
  const { error } = await supabase.rpc('admin_decide_credential', { p_id: rowId, p_approve: approve, p_note: note });
  if (error) throw error;
}

// ── Grant / remove credentials (admin override) ──────────────────────────────
// Grant a VERIFIED credential to a worker directly (e.g. you checked it another way).
export async function adminGrantCredential(operatorId, credentialId, number = null, expiresAt = null) {
  const { error } = await supabase.rpc('admin_grant_credential', {
    p_operator_id: operatorId, p_credential_id: credentialId, p_number: number, p_expires_at: expiresAt,
  });
  if (error) throw error;
}
export async function adminRemoveCredential(rowId) {
  const { error } = await supabase.rpc('admin_remove_credential', { p_id: rowId });
  if (error) throw error;
}
// A specific worker's full credential list (for the grant/remove view).
export async function adminUserCredentials(operatorId) {
  const { data, error } = await supabase.rpc('admin_user_credentials', { p_operator_id: operatorId });
  if (error) throw error;
  return data || [];
}

// ── ABN reviews ──────────────────────────────────────────────────────────────
export async function adminPendingAbns() {
  const { data, error } = await supabase.rpc('admin_pending_abns');
  if (error) throw error;
  return data || [];
}
// kind: 'worker' | 'company'
export async function adminDecideAbn(userId, kind, approve) {
  const { error } = await supabase.rpc('admin_decide_abn', { p_user_id: userId, p_kind: kind, p_approve: approve });
  if (error) throw error;
}

// ── User lookup ──────────────────────────────────────────────────────────────
export async function adminSearchUsers(q) {
  const { data, error } = await supabase.rpc('admin_search_users', { p_q: q || '' });
  if (error) throw error;
  return data || [];
}

// ── Ops health (read-only) ───────────────────────────────────────────────────
export async function adminActiveJobs() {
  const { data, error } = await supabase.rpc('admin_active_jobs');
  if (error) throw error;
  return data || [];
}
