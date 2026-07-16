// communityService.js — the social/community layer over capabilities.
// A worker's skills are tappable tags; tapping one finds OTHER verified workers who
// hold the same skill, so workers can discover and gauge their peers. Screens call
// these; no direct supabase in the UI (CLAUDE.md §2).
import { supabase } from './supabaseClient';

/**
 * Verified workers who supply a given skill (by trade name), so a client or peer can
 * discover others who do the same work. Read-only discovery — no messaging yet.
 *
 * Backed by the SECURITY DEFINER RPC `workers_with_skill(p_skill text)`, which enforces
 * the "a tag only means a proven/eligible skill" rule server-side (gates on can_work).
 * Degrades gracefully: if the RPC isn't deployed yet, returns [] rather than throwing,
 * so the profile never breaks — the list just reads empty until the function is live.
 */
export async function workersWithSkill(skill, excludeUserId = null) {
  if (!skill) return [];
  try {
    const { data, error } = await supabase.rpc('workers_with_skill', { p_skill: skill });
    if (error) throw error;
    let rows = data || [];
    if (excludeUserId) rows = rows.filter((r) => r.user_id !== excludeUserId);
    return rows;
  } catch (_) {
    // RPC not deployed / transient — discovery is ambient, a miss just shows an empty list.
    return [];
  }
}
