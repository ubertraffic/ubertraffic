// supabaseClient.js
// The ONE place the app talks to Supabase. Every screen imports from here —
// never creates its own client. (Service layer, per the engineering rules.)
//
// The anon key is safe in the client: it can only do what your Row Level
// Security policies allow. The service_role key must NEVER appear here.

// URL polyfill for older RN runtimes. Wrapped so a missing/unresolved polyfill can't crash the
// whole app — modern supabase-js works without it in most environments (incl. Snack web).
try { require('react-native-url-polyfill/auto'); } catch (_) {}
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// In the real project these come from env vars, not inline. Inline is fine for
// a Snack login test because the anon key is public by design.
const SUPABASE_URL = 'https://bxwdgrkfrbtryygmorpa.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4d2RncmtmcmJ0cnl5Z21vcnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1Nzc2MDYsImV4cCI6MjA5OTE1MzYwNn0.nE1wb1XPNdTc_qypyv6cEejtTESxcb0A_qnX2TMJJdU';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // React Native, not web
  },
});

// The signed-in user's id, robust to a transient getUser() blip. getUser() makes a NETWORK call and
// can momentarily resolve to a null user (token refresh / flaky signal); callers that then read
// `.user.id` crash with "Cannot read property 'id' of null" — an intermittent, hard-to-reproduce
// error. getSession() reads the locally-stored session with NO network, so it covers the gap.
// Returns null only when genuinely signed out.
export async function currentUserId() {
  const viaUser = (await supabase.auth.getUser())?.data?.user?.id;
  if (viaUser) return viaUser;
  const viaSession = (await supabase.auth.getSession())?.data?.session?.user?.id;
  return viaSession || null;
}
