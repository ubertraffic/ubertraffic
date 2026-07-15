// pulseService.js — the app's heartbeat. Reads anonymised activity (names are
// stripped server-side; the client never sees them). Real + sim blended.
import { supabase } from './supabaseClient';

export async function getPulseFeed(limit = 20) {
  const { data, error } = await supabase.rpc('pulse_feed', { p_limit: limit });
  if (error) throw error;
  return data || [];
}

export async function getPulseStats() {
  const { data, error } = await supabase.rpc('pulse_stats');
  if (error) throw error;
  return (data && data[0]) || { jobs_completed_today: 0, paid_to_workers_today: 0, active_now: 0 };
}
