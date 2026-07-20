// connect-onboard — sets a worker up to receive payouts. Finds-or-creates their ONE Stripe Express
// connected account, stores its id on their profile (profiles.stripe_account_id), and returns a
// Stripe-hosted onboarding link. Card/bank details are entered on Stripe, never in the app.
//
// DEDUP (important): a previous version created a NEW account on every call whenever the stored id was
// missing, which spawned many duplicate accounts. Now, before creating, we (1) reuse the stored id,
// (2) failing that, search Stripe for an account already tagged with this user_id (preferring an
// enabled one), and (3) only create as a last resort — with an Idempotency-Key so rapid double-taps
// can't create two. The profile store is also error-checked so a silent write failure is visible.
//
// Deploy as 'connect-onboard'. Secret: STRIPE_SECRET_KEY. Optional: CONNECT_RETURN_URL, CONNECT_REFRESH_URL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
async function stripe(path: string, secret: string, params?: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers, body: params ? new URLSearchParams(params).toString() : "" });
  return { ok: res.ok, body: await res.json() };
}

// Find THIS user's existing connected account (tagged metadata.user_id), preferring an enabled one.
async function findUserAccount(secret: string, userId: string): Promise<string | null> {
  const res = await fetch("https://api.stripe.com/v1/accounts?limit=100", { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) return null;
  const body = await res.json();
  const mine = ((body.data as any[]) || []).filter((a) => a?.metadata?.user_id === userId);
  if (!mine.length) return null;
  return (mine.find((a) => a.payouts_enabled) || mine[0]).id;
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

    // 1) reuse the remembered account; 2) else adopt an existing Stripe account for this user (dedup).
    if (!acct) acct = await findUserAccount(secret, user.id);

    // 3) last resort: create ONE (idempotency-keyed on the user so a double-tap can't make two).
    if (!acct) {
      const created = await stripe("accounts", secret, {
        type: "express",
        country: "AU",
        email: user.email || "",
        "capabilities[transfers][requested]": "true",
        "business_type": "individual",
        "metadata[user_id]": user.id,
      }, `connect:${user.id}`);
      if (!created.ok) return json({ error: "account_create_failed", detail: created.body?.error?.message }, 502);
      acct = created.body.id;
    }

    // Remember it — and surface a write failure instead of silently swallowing it (a swallowed failure
    // here is exactly what let duplicates accumulate).
    const { error: upErr } = await admin.from("profiles").update({ stripe_account_id: acct }).eq("id", user.id);
    if (upErr) return json({ error: "store_failed", detail: upErr.message, account_id: acct }, 500);

    const returnUrl = Deno.env.get("CONNECT_RETURN_URL") || "https://example.com/payouts-ready";
    const refreshUrl = Deno.env.get("CONNECT_REFRESH_URL") || "https://example.com/payouts-refresh";
    const link = await stripe("account_links", secret, {
      account: acct!,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: "account_onboarding",
    });
    if (!link.ok) return json({ error: "link_failed", detail: link.body?.error?.message }, 502);

    return json({ url: link.body.url, account_id: acct });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
