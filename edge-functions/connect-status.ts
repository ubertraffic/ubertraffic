// connect-status — is this worker ready to receive payouts? Reads their Stripe Express account.
// Returns { onboarded, payouts_enabled, details_submitted }. Deploy as 'connect-status'.
// Secret: STRIPE_SECRET_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
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
    const acct = (prof as any)?.stripe_account_id;
    if (!acct) return json({ onboarded: false, payouts_enabled: false, details_submitted: false });

    const res = await fetch(`https://api.stripe.com/v1/accounts/${acct}`, { headers: { Authorization: `Bearer ${secret}` } });
    const a = await res.json();
    if (!res.ok) return json({ error: "stripe_error", detail: a?.error?.message }, 502);

    // Diagnostic detail so the app (and support) can see WHY an account isn't ready instead of just a
    // yes/no. currently_due/past_due = what Stripe needs NOW; disabled_reason = why payouts are off.
    // future 'eventually_due' items (e.g. an ID doc at a volume threshold) do NOT block payouts today.
    const reqs = (a.requirements || {}) as any;
    return json({
      onboarded: !!a.payouts_enabled,
      payouts_enabled: !!a.payouts_enabled,
      charges_enabled: !!a.charges_enabled,
      details_submitted: !!a.details_submitted,
      account_id: acct,
      disabled_reason: reqs.disabled_reason || null,
      currently_due: reqs.currently_due || [],
      past_due: reqs.past_due || [],
    });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
