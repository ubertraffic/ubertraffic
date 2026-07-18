// capture-payment — the client approves the work: CAPTURE the held funds, then pay each completed
// worker via a Connect transfer. The platform keeps PLATFORM_FEE_PCT (env, default 10%).
//
// SAFETY (money-critical — do not weaken):
//  1. Never capture with no completed worker to pay (would charge the client for nothing).
//  2. IDEMPOTENT: capture and every transfer carry a Stripe Idempotency-Key, so a retry / double-tap
//     can't double-charge or double-pay.
//  3. RESUMABLE: if the function is re-invoked after capturing (payouts failed / it died mid-loop),
//     it does NOT capture again — it resumes and pays only the workers who don't yet have a
//     successful payout. This removes the terminal "client charged, worker unpaid, no recovery" state.
//  4. HONEST: if any payout fails, it says so (all_paid:false + failed[]) instead of reporting success.
//
// SECURITY: only the client who owns the request can capture. Amounts are computed SERVER-SIDE.
// Deploy as 'capture-payment'. Secret: STRIPE_SECRET_KEY. Optional: PLATFORM_FEE_PCT.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
// stripe() with optional Idempotency-Key so retries never duplicate money movements.
async function stripe(path: string, secret: string, params?: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers, body: params ? new URLSearchParams(params).toString() : "" });
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

    // Accept an 'authorized' hold (normal case) OR an already-'captured' payment (resume payouts).
    const { data: pay } = await admin
      .from("payments").select("id, client_id, status, stripe_payment_intent, tip_cents, travel_cents")
      .eq("request_id", requestId).in("status", ["authorized", "captured"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!pay) return json({ error: "no_held_payment", detail: "No authorized payment to capture on this job." }, 404);
    if ((pay as any).client_id !== user.id) return json({ error: "not_your_request" }, 403);
    const payId = (pay as any).id;
    const piId = (pay as any).stripe_payment_intent;
    if (!piId) return json({ error: "no_payment_intent" }, 400);

    // SAFETY GATE — resolve who gets paid BEFORE we capture a cent.
    const { data: req0 } = await admin.from("requests").select("duration_hours").eq("id", requestId).maybeSingle();
    const hours = Number((req0 as any)?.duration_hours) || 4;
    const { data: items } = await admin.from("request_items").select("id, rate, price_mode").eq("request_id", requestId);
    const itemById: Record<string, any> = {};
    for (const it of (items as any[]) || []) itemById[it.id] = it;

    const { data: assigns } = await admin
      .from("assignments").select("id, operator_id, request_item_id, status")
      .in("request_item_id", Object.keys(itemById))
      .in("status", ["complete", "approved"]);
    const toPay = ((assigns as any[]) || []).filter((a) => a.operator_id && itemById[a.request_item_id]);
    if (toPay.length === 0) {
      return json({ error: "no_worker_to_pay", detail: "No worker has completed this job yet — nothing to capture or pay." }, 409);
    }

    // CAPTURE (only if not already captured). Idempotency-Key keyed on the payment row → a retry or
    // double-tap can never capture twice. If Stripe says it's already captured, treat as success.
    let chargeId: string | null = null;
    if ((pay as any).status !== "captured") {
      const cap = await stripe(`payment_intents/${piId}/capture`, secret, undefined, `capture:${payId}`);
      if (!cap.ok) {
        const code = cap.body?.error?.code;
        if (code === "payment_intent_unexpected_state" || cap.body?.error?.payment_intent?.status === "succeeded") {
          // already captured previously — fall through to resume payouts
        } else {
          return json({ error: "capture_failed", detail: cap.body?.error?.message || "capture error" }, 502);
        }
      }
      chargeId = cap.body?.latest_charge || cap.body?.error?.payment_intent?.latest_charge || null;
      await admin.from("payments").update({ status: "captured", updated_at: new Date().toISOString() }).eq("id", payId);
    }
    // Resume path (or capture didn't return the charge): fetch the charge id from the PI.
    if (!chargeId) {
      const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}`, { headers: { Authorization: `Bearer ${secret}` } });
      const piObj = await piRes.json();
      chargeId = piObj?.latest_charge || null;
    }

    // Skip anyone already paid (idempotent resume) — only 'paid' payout rows count as done.
    const { data: prevPayouts } = await admin.from("payouts").select("assignment_id, status").eq("request_id", requestId);
    const alreadyPaid = new Set(((prevPayouts as any[]) || []).filter((p) => p.status === "paid").map((p) => p.assignment_id));

    const tipCents = Math.max(0, Number((pay as any).tip_cents) || 0);
    const travelCents = Math.max(0, Number((pay as any).travel_cents) || 0);
    const perWorkerExtra = toPay.length ? Math.floor((tipCents + travelCents) / toPay.length) : 0;

    const results: any[] = [];
    const failed: any[] = [];
    for (const a of toPay) {
      if (alreadyPaid.has(a.id)) { results.push({ operator_id: a.operator_id, skipped: "already_paid" }); continue; }
      const it = itemById[a.request_item_id];
      const isTask = it.price_mode === "job";
      const base = isTask
        ? Math.round(Number(it.rate || 0) * 100)
        : Math.round(Number(it.rate || 0) * hours * 100 * (1 - feePct / 100));
      const net = base + perWorkerExtra;
      if (net < 1) { results.push({ operator_id: a.operator_id, skipped: "zero" }); continue; }

      const { data: prof } = await admin.from("profiles").select("stripe_account_id").eq("id", a.operator_id).maybeSingle();
      const acct = (prof as any)?.stripe_account_id;
      if (!acct) { failed.push({ operator_id: a.operator_id, reason: "not_onboarded", net }); results.push({ operator_id: a.operator_id, skipped: "not_onboarded", net }); continue; }

      // Idempotency-Key keyed on the assignment → the same worker can never be transferred twice.
      const tf = await stripe("transfers", secret, {
        amount: String(net), currency: "aud", destination: acct,
        transfer_group: requestId, ...(chargeId ? { source_transaction: chargeId } : {}),
      }, `payout:${a.id}`);
      await admin.from("payouts").insert({
        request_id: requestId, assignment_id: a.id, operator_id: a.operator_id,
        amount_cents: net, currency: "aud", stripe_transfer_id: tf.ok ? tf.body?.id : null,
        status: tf.ok ? "paid" : "failed", detail: tf.ok ? null : (tf.body?.error?.message || "transfer error"),
      });
      if (!tf.ok) failed.push({ operator_id: a.operator_id, reason: tf.body?.error?.message || "transfer_failed", net });
      results.push({ operator_id: a.operator_id, net, paid: tf.ok });
    }

    // Honest result: captured is true (money moved), but flag if not everyone was paid so the app
    // (or a reconciler re-invoking this function) can finish/surface it rather than showing success.
    return json({ captured: true, all_paid: failed.length === 0, fee_pct: feePct, payouts: results, failed });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
