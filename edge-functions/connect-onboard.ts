// connect-onboard — sets a worker up to receive payouts. Creates (or reuses) their Stripe Express
// connected account, stores its id on their profile (profiles.stripe_account_id), and returns a
// Stripe-hosted onboarding link. Card/bank details are entered on Stripe, never in the app.
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
async function stripe(path: string, secret: string, params?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params).toString() : "",
  });
  return { ok: res.ok, body: await res.json() };
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

    // Create the Express account once, then reuse it.
    if (!acct) {
      const created = await stripe("accounts", secret, {
        type: "express",
        country: "AU",
        email: user.email || "",
        "capabilities[transfers][requested]": "true",
        "business_type": "individual",
        "metadata[user_id]": user.id,
      });
      if (!created.ok) return json({ error: "account_create_failed", detail: created.body?.error?.message }, 502);
      acct = created.body.id;
      await admin.from("profiles").update({ stripe_account_id: acct }).eq("id", user.id);
    }

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
