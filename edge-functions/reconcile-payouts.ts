// reconcile-payouts — the safety net for the "silent client / approved-but-uncaptured" gap. A job can
// be APPROVED (client tapped approve, OR the system auto-approved after the client went quiet) while its
// held payment was never captured — so the worker is recorded as owed but not actually paid. This runs
// on a schedule, finds those jobs, and CAPTURES the held funds + pays each worker THEIR settled amount,
// entirely from money already on hold (it never fronts money). Idempotent — safe to re-run.
//
// Gated by a shared secret (RECONCILE_SECRET) so only the scheduler can invoke it — there's no user
// session. Deploy as 'reconcile-payouts'. Secrets: STRIPE_SECRET_KEY, RECONCILE_SECRET,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional: PLATFORM_FEE_PCT.
//
// Schedule it (pick one):
//   • Supabase → Database → Cron (pg_cron + pg_net) to POST this function hourly, or
//   • any external scheduler hitting the function URL hourly with { "secret": "<RECONCILE_SECRET>" }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function stripe(path: string, secret: string, params?: Record<string, string>, idempotencyKey?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
  if (params) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers, body: params ? new URLSearchParams(params).toString() : "" });
  return { ok: res.ok, body: await res.json() };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const secret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!secret) return json({ error: "stripe_not_configured" }, 500);
    const wantSecret = Deno.env.get("RECONCILE_SECRET");
    const body = await req.json().catch(() => ({}));
    if (!wantSecret || (body?.secret || "").toString() !== wantSecret) return json({ error: "unauthorized" }, 401);
    const feePct = Math.max(0, Math.min(100, Number(Deno.env.get("PLATFORM_FEE_PCT") || "10")));

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Held payments whose job is already approved → the capture/transfer never completed.
    const { data: pays } = await admin
      .from("payments").select("id, request_id, client_id, status, stripe_payment_intent, tip_cents, travel_cents")
      .eq("status", "authorized").order("created_at", { ascending: true }).limit(100);

    const results: any[] = [];
    for (const pay of (pays as any[]) || []) {
      const requestId = pay.request_id;
      const { data: reqRow } = await admin.from("requests").select("approved_at, duration_hours").eq("id", requestId).maybeSingle();
      if (!(reqRow as any)?.approved_at) continue;   // not approved yet → the hold is legitimately still pending
      const piId = pay.stripe_payment_intent;
      if (!piId) { results.push({ requestId, skipped: "no_payment_intent" }); continue; }

      const hours = Number((reqRow as any).duration_hours) || 4;
      const { data: items } = await admin.from("request_items").select("id, rate, price_mode").eq("request_id", requestId);
      const itemById: Record<string, any> = {};
      for (const it of (items as any[]) || []) itemById[it.id] = it;
      const { data: assigns } = await admin
        .from("assignments").select("id, operator_id, request_item_id, status, net_amount")
        .in("request_item_id", Object.keys(itemById)).in("status", ["complete", "approved"]);
      const toPay = ((assigns as any[]) || []).filter((a) => a.operator_id && itemById[a.request_item_id]);
      if (toPay.length === 0) { results.push({ requestId, skipped: "no_worker" }); continue; }

      // CAPTURE (idempotent). If already captured, fall through to pay.
      let chargeId: string | null = null;
      const cap = await stripe(`payment_intents/${piId}/capture`, secret, undefined, `capture:${pay.id}`);
      if (!cap.ok && cap.body?.error?.code !== "payment_intent_unexpected_state" && cap.body?.error?.payment_intent?.status !== "succeeded") {
        results.push({ requestId, failed: cap.body?.error?.message || "capture_failed" });   // e.g. hold expired
        continue;
      }
      chargeId = cap.body?.latest_charge || cap.body?.error?.payment_intent?.latest_charge || null;
      await admin.from("payments").update({ status: "captured", updated_at: new Date().toISOString() }).eq("id", pay.id);
      if (!chargeId) {
        const piRes = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}`, { headers: { Authorization: `Bearer ${secret}` } });
        chargeId = (await piRes.json())?.latest_charge || null;
      }

      const { data: prevPayouts } = await admin.from("payouts").select("assignment_id, status").eq("request_id", requestId);
      const alreadyPaid = new Set(((prevPayouts as any[]) || []).filter((p) => p.status === "paid").map((p) => p.assignment_id));
      const extra = Math.max(0, Number(pay.tip_cents) || 0) + Math.max(0, Number(pay.travel_cents) || 0);
      const perWorkerExtra = toPay.length ? Math.floor(extra / toPay.length) : 0;

      let paidCount = 0;
      for (const a of toPay) {
        if (alreadyPaid.has(a.id)) continue;
        const it = itemById[a.request_item_id];
        const settledDollars = Number(a.net_amount);
        const base = settledDollars > 0 ? Math.round(settledDollars * 100)
          : (it.price_mode === "job" ? Math.round(Number(it.rate || 0) * 100) : Math.round(Number(it.rate || 0) * hours * 100 * (1 - feePct / 100)));
        const net = base + perWorkerExtra;
        if (net < 1) continue;
        const { data: prof } = await admin.from("profiles").select("stripe_account_id").eq("id", a.operator_id).maybeSingle();
        const acct = (prof as any)?.stripe_account_id;
        if (!acct) { await admin.from("payouts").insert({ request_id: requestId, assignment_id: a.id, operator_id: a.operator_id, amount_cents: net, currency: "aud", status: "failed", detail: "not_onboarded" }); continue; }
        const tf = await stripe("transfers", secret, { amount: String(net), currency: "aud", destination: acct, transfer_group: requestId, ...(chargeId ? { source_transaction: chargeId } : {}) }, `payout:${a.id}`);
        await admin.from("payouts").insert({ request_id: requestId, assignment_id: a.id, operator_id: a.operator_id, amount_cents: net, currency: "aud", stripe_transfer_id: tf.ok ? tf.body?.id : null, status: tf.ok ? "paid" : "failed", detail: tf.ok ? null : (tf.body?.error?.message || "transfer error") });
        if (tf.ok) paidCount++;
      }
      results.push({ requestId, captured: true, paid: paidCount });
    }

    return json({ ran: true, scanned: (pays as any[])?.length || 0, reconciled: results.filter((r) => r.captured).length, results });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
