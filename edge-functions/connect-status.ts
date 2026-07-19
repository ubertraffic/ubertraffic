// connect-status — is this worker ready to receive payouts? Reads their Stripe Express account.
// SELF-HEALING: the app remembers one account on profiles.stripe_account_id, but if that pointer is
// missing or points at a not-enabled account (e.g. onboarding created duplicates), we search Stripe
// for the accounts tagged with this user_id and lock onto the ENABLED one, then persist it. That way
// a lost/duplicated account can never leave a genuinely-onboarded worker stuck on "set up payouts".
// Returns { onboarded, payouts_enabled, details_submitted, account_id, currently_due, ... }.
// Deploy as 'connect-status'. Secret: STRIPE_SECRET_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

// Fetch one Stripe account by id (null if it 404s / is gone).
async function getAccount(secret: string, id: string): Promise<any | null> {
  const res = await fetch(`https://api.stripe.com/v1/accounts/${id}`, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) return null;
  return await res.json();
}

// Find THIS user's connected accounts (tagged metadata.user_id) and return the best one — an enabled
// account if any, else the most recently created. Null if the user has none.
async function findUserAccount(secret: string, userId: string): Promise<any | null> {
  const res = await fetch("https://api.stripe.com/v1/accounts?limit=100", { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) return null;
  const body = await res.json();
  const mine = ((body.data as any[]) || []).filter((a) => a?.metadata?.user_id === userId);
  if (!mine.length) return null;
  return mine.find((a) => a.payouts_enabled) || mine[0];   // list is newest-first, so mine[0] = latest
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "stripe_not_configured" }, 500);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("stripe_account_id").eq("id", user.id).maybeSingle();
    let acct = (prof as any)?.stripe_account_id as string | null;

    // Load the remembered account (if any).
    let a: any = acct ? await getAccount(secret, acct) : null;

    // SELF-HEAL: no account, a dead pointer, or a not-yet-enabled account → look for a better one this
    // user owns in Stripe (prefers enabled) and adopt it. Fixes the "lost pointer / duplicate accounts"
    // state where the app forgot which of several accounts is the good one.
    if (!a || !a.payouts_enabled) {
      const found = await findUserAccount(secret, user.id);
      if (found && (!a || found.payouts_enabled)) {
        a = found;
        if (found.id !== acct) {
          acct = found.id;
          await admin.from("profiles").update({ stripe_account_id: acct }).eq("id", user.id);
        }
      }
    }

    if (!a) {
      return json({ onboarded: false, payouts_enabled: false, details_submitted: false, account_id: null, currently_due: [], note: "no_account_linked" });
    }

    const reqs = (a.requirements || {}) as any;
    return json({
      onboarded: !!a.payouts_enabled,
      payouts_enabled: !!a.payouts_enabled,
      charges_enabled: !!a.charges_enabled,
      details_submitted: !!a.details_submitted,
      account_id: a.id,
      disabled_reason: reqs.disabled_reason || null,
      currently_due: reqs.currently_due || [],
      past_due: reqs.past_due || [],
    });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
