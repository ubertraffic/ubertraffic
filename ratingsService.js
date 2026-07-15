// ratingsService.js — thin, honest wrapper around the server-side rating RPCs.
// All validation (who may rate, job must be complete, no double-rating) lives in
// the `submit_rating` Postgres function; the client only ever calls it. Per
// CLAUDE.md §2, external/data calls are wrapped here, not scattered through UI.
import { supabase } from './supabaseClient';

/**
 * Submit a rating for a completed assignment. Direction (client→operator or
 * operator→client) is inferred server-side from who is calling — the client
 * never asserts it. Throws on: not a party to the job, job not complete,
 * already rated, or bad score.
 */
export async function submitRating(assignmentId, score, comment = null) {
  const { data, error } = await supabase.rpc('submit_rating', {
    p_assignment_id: assignmentId,
    p_score: score,
    p_comment: comment,
  });
  if (error) throw error;
  return data;
}

/**
 * Has the current user already rated this assignment (in their direction)?
 * Used to hide the prompt once they've rated. Relies on RLS: the select policy
 * only returns rows the caller wrote or is the subject of.
 */
export async function myRatingForAssignment(assignmentId) {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('ratings')
    .select('id, score, comment, direction')
    .eq('assignment_id', assignmentId)
    .eq('rater_id', uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}
