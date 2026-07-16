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

/**
 * Workmates who were on the same job as me (by request), so I can vouch for them.
 * Server-verified: only returns people if I was genuinely on that job too (no leaking a
 * job's roster to someone who wasn't there). Excludes me. Degrades to [] if not deployed.
 */
export async function coworkersOnJob(requestId) {
  if (!requestId) return [];
  try {
    const { data, error } = await supabase.rpc('coworkers_on_job', { p_request_id: requestId });
    if (error) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

/**
 * Vouch for a workmate on a shared job, optionally with "good unit" tags. The server
 * checks BOTH of us actually worked that job before recording it — that's the un-gameable
 * rule (you can only vouch for someone you were really on site with). Re-vouching updates
 * the tags. Throws on a real failure so the caller can show a message.
 */
export async function vouchForPeer(requestId, peerId, tags = []) {
  const { error } = await supabase.rpc('vouch_for_peer', {
    p_request_id: requestId,
    p_peer_id: peerId,
    p_tags: tags,
  });
  if (error) throw error;
}
