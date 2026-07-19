// payout-actions — worker payout controls, all acting on the caller's own Stripe Express account:
//   action 'balance'  → available + instant-available balance and the current payout schedule
//   action 'schedule' → set the STANDARD payout schedule (daily | weekly)
//   action 'instant'  → cash out now (Instant Payout, ~30 min) for a fee
//
// The instant fee is taken as an application_fee that covers Stripe's AU instant-payout cost (~1.5%)
// PLUS a small margin. Configure the total worker-facing rate with INSTANT_FEE_PCT (default 2.5).
// NOTE: Instant Payouts need an instant-eligible external account (a debit card is the reliable rail)
// and the account/platform to be instant-eligible — verify end-to-end in Stripe TEST MODE before live.
//
// Deploy as 'payout-actions'. Secrets: STRIPE_SECRET_KEY. Optional: INSTANT_FEE_PCT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
// Stripe REST helper. `onBehalf` sets the Stripe-Account header so the call acts AS the connected account.
async function stripe(path: string, secret: string, opts: { method?: string; params?: Record<string, string>; onBehalf?: string; idempotencyKey?: string } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  if (opts.params) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts.onBehalf) headers["Stripe-Account"] = opts.onBehalf;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: opts.method || (opts.params ? "POST" : "GET"),
    headers,
    body: opts.params ? new URLSearchParams(opts.params).toString() : undefined,
  });
  return { ok: res.ok, body: await res.json() };
}
const audAmount = (arr: any[]): number => {
  const row = (arr || []).find((b) => (b.currency || "").toLowerCase() === "aud") || (arr || [])[0];
  return Math.max(0, Number(row?.amount) || 0);   // cents
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "stripe_not_configured" }, 500);
    const feePct = Math.max(0, Number(Deno.env.get("INSTANT_FEE_PCT") || "2.5"));

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin.from("profiles").select("stripe_account_id").eq("id", user.id).maybeSingle();
    const acct = (prof as any)?.stripe_account_id as string | null;
    if (!acct) return json({ error: "no_payout_account", detail: "Set up payouts first." }, 400);

    const body = await req.json().catch(() => ({}));
    const action = (body?.action || "balance").toString();

    // ── balance + current schedule ──────────────────────────────────────────
    if (action === "balance") {
      const bal = await stripe("balance", secret, { onBehalf: acct });
      const acc = await stripe(`accounts/${acct}`, secret, {});
      if (!bal.ok) return json({ error: "stripe_error", detail: bal.body?.error?.message }, 502);
      const sched = acc.body?.settings?.payouts?.schedule || {};
      return json({
        available_cents: audAmount(bal.body?.available),
        instant_available_cents: audAmount(bal.body?.instant_available),
        instant_eligible: audAmount(bal.body?.instant_available) > 0,
        schedule: { interval: sched.interval || "daily", weekly_anchor: sched.weekly_anchor || null, delay_days: sched.delay_days ?? null },
        fee_pct: feePct,
      });
    }

    // ── set the standard schedule (daily | weekly) ──────────────────────────
    if (action === "schedule") {
      const interval = (body?.interval || "").toString();
      if (!["daily", "weekly"].includes(interval)) return json({ error: "bad_interval" }, 400);
      const params: Record<string, string> = { "settings[payouts][schedule][interval]": interval };
      if (interval === "weekly") params["settings[payouts][schedule][weekly_anchor]"] = (body?.weekly_anchor || "friday").toString();
      // Updating a connected account is a PLATFORM call (account id in the URL), not on-behalf.
      const upd = await stripe(`accounts/${acct}`, secret, { params });
      if (!upd.ok) return json({ error: "stripe_error", detail: upd.body?.error?.message }, 502);
      return json({ ok: true, interval });
    }

    // ── instant payout (cash out now, for a fee) ────────────────────────────
    if (action === "instant") {
      const bal = await stripe("balance", secret, { onBehalf: acct });
      if (!bal.ok) return json({ error: "stripe_error", detail: bal.body?.error?.message }, 502);
      const instantCents = audAmount(bal.body?.instant_available);
      if (instantCents < 100) return json({ error: "nothing_to_cash_out", detail: "No balance available for an instant payout yet." }, 400);

      // Our application fee covers Stripe's instant cost + margin. The worker receives the rest.
      const fee = Math.max(0, Math.round(instantCents * (feePct / 100)));
      const payoutAmount = instantCents - fee;
      if (payoutAmount < 1) return json({ error: "amount_too_small" }, 400);

      const params: Record<string, string> = {
        amount: String(payoutAmount), currency: "aud", method: "instant",
        "metadata[kind]": "instant_cashout",
      };
      if (fee > 0) params["application_fee"] = String(fee);
      // Idempotency-Key keyed to the account + the exact instant balance so a double-tap can't double pay.
      const pay = await stripe("payouts", secret, { params, onBehalf: acct, idempotencyKey: `instant:${acct}:${instantCents}` });
      if (!pay.ok) return json({ error: "instant_failed", detail: pay.body?.error?.message || "instant payout error" }, 502);
      return json({ ok: true, paid_cents: payoutAmount, fee_cents: fee, arrival: "≈30 min", payout_id: pay.body?.id });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
