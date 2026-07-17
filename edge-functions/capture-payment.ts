// capture-payment — the client approves the work, so we CAPTURE the held funds (money actually
// moves) and then pay out each assigned worker their share via a Connect transfer. The platform
// keeps PLATFORM_FEE_PCT (env, default 10%). Workers who haven't finished payout setup are simply
// skipped (their share stays with the platform until they onboard — nothing is lost).
//
// SECURITY: only the client who owns the request can capture. Amounts are computed SERVER-SIDE.
// Secret key stays server-side. Deploy as 'capture-payment'. Secret: STRIPE_SECRET_KEY. Optional: PLATFORM_FEE_PCT.
//
// NOTE (needs your sign-off before live): the split here is "each assignment's rate × hours, minus
// the platform fee, to that worker". Confirm the fee % and the multi-worker split model before go-live.
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
    const feePct = Math.max(0, Math.min(100, Number(Deno.env.get("PLATFORM_FEE_PCT") || "10")));

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const requestId = (body?.request_id || "").toString();
    if (!requestId) return json({ error: "missing_request_id" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: pay } = await admin
      .from("payments").select("id, client_id, status, stripe_payment_intent")
      .eq("request_id", requestId).eq("status", "authorized")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!pay) return json({ error: "no_held_payment", detail: "No authorized payment to capture on this job." }, 404);
    if ((pay as any).client_id !== user.id) return json({ error: "not_your_request" }, 403);
    const piId = (pay as any).stripe_payment_intent;
    if (!piId) return json({ error: "no_payment_intent" }, 400);

    // 1) Capture the hold — money moves to the platform now.
    const cap = await stripe(`payment_intents/${piId}/capture`, secret);
    if (!cap.ok) return json({ error: "capture_failed", detail: cap.body?.error?.message || "capture error" }, 502);
    const chargeId = cap.body?.latest_charge;
    await admin.from("payments").update({ status: "captured", updated_at: new Date().toISOString() }).eq("id", (pay as any).id);

    // 2) Pay out each assigned worker their share (skip anyone not onboarded for payouts).
    const { data: req0 } = await admin.from("requests").select("duration_hours").eq("id", requestId).maybeSingle();
    const hours = Number((req0 as any)?.duration_hours) || 4;
    const { data: items } = await admin.from("request_items").select("id, rate, price_mode").eq("request_id", requestId);
    const itemById: Record<string, any> = {};
    for (const it of (items as any[]) || []) itemById[it.id] = it;

    const { data: assigns } = await admin
      .from("assignments").select("id, operator_id, request_item_id, status")
      .in("request_item_id", Object.keys(itemById))
      .in("status", ["complete", "approved"]);

    const results: any[] = [];
    for (const a of (assigns as any[]) || []) {
      const it = itemById[a.request_item_id];
      if (!it || !a.operator_id) continue;
      const units = it.price_mode === "job" ? 1 : hours;
      const gross = Math.round(Number(it.rate || 0) * units * 100);
      const net = Math.round(gross * (1 - feePct / 100));
      if (net < 1) { results.push({ operator_id: a.operator_id, skipped: "zero" }); continue; }

      const { data: prof } = await admin.from("profiles").select("stripe_account_id").eq("id", a.operator_id).maybeSingle();
      const acct = (prof as any)?.stripe_account_id;
      if (!acct) { results.push({ operator_id: a.operator_id, skipped: "not_onboarded", net }); continue; }

      const tf = await stripe("transfers", secret, {
        amount: String(net), currency: "aud", destination: acct,
        transfer_group: requestId, ...(chargeId ? { source_transaction: chargeId } : {}),
      });
      await admin.from("payouts").insert({
        request_id: requestId, assignment_id: a.id, operator_id: a.operator_id,
        amount_cents: net, currency: "aud", stripe_transfer_id: tf.ok ? tf.body?.id : null,
        status: tf.ok ? "paid" : "failed", detail: tf.ok ? null : (tf.body?.error?.message || "transfer error"),
      });
      results.push({ operator_id: a.operator_id, net, paid: tf.ok, detail: tf.ok ? null : tf.body?.error?.message });
    }

    return json({ captured: true, fee_pct: feePct, payouts: results });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
