// beatsService.js — enriched lifecycle "beats" for the moment-card notifications.
// Real jobs only (server strips sim). Each beat already carries the human detail
// a warm toast needs: role, what happened, the other party's first name, suburb.
import { supabase } from './supabaseClient';

export async function getRecentBeats(sinceIso) {
  const { data, error } = await supabase.rpc('my_recent_beats',
    sinceIso ? { p_since: sinceIso } : {});
  if (error) throw error;
  return data || [];
}
