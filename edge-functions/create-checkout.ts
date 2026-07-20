// create-checkout — Supabase Edge Function. Creates a Stripe Checkout Session for a job and
// returns the hosted-payment URL. The secret key lives ONLY here (Deno.env STRIPE_SECRET_KEY),
// never in the app. Snack can't run Stripe's native SDK, so we use hosted Checkout: the app opens
// the returned URL, Stripe collects the card, and the payment status is confirmed via checkout-status.
//
// SECURITY (CLAUDE.md): the amount is computed SERVER-SIDE from the request the caller owns — the
// client only sends a request_id, never a price, so it can't underpay. Rows are written with the
// service-role key (RLS blocks any client write to `payments`).
//
// Deploy: Supabase → Edge Functions → new function 'create-checkout' → paste → Deploy.
// Secrets required: STRIPE_SECRET_KEY (sk_test_… for now). Optional: STRIPE_SUCCESS_URL,
// STRIPE_CANCEL_URL (default to a placeholder page; the app polls checkout-status either way).
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

    // who's calling
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const requestId = (body?.request_id || "").toString();
    if (!requestId) return json({ error: "missing_request_id" }, 400);

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceKey) return json({ error: "server_misconfigured", detail: "SUPABASE_SERVICE_ROLE_KEY is not set on this function — it can't read the job. Add it in the function's secrets." }, 500);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // The request must exist AND belong to the caller — never let someone pay against a job they don't own.
    // NB: we surface the real DB error instead of swallowing it — a swallowed error here used to masquerade
    // as "request_not_found" (e.g. a missing column, or a non-service-role key hitting RLS).
    const { data: request, error: reqErr } = await admin
      .from("requests").select("id, client_id, duration_hours, address_text, travel_cents").eq("id", requestId).maybeSingle();
    if (reqErr) return json({ error: "request_lookup_failed", detail: `${reqErr.message}${reqErr.hint ? ` — ${reqErr.hint}` : ""}`, request_id: requestId }, 500);
    if (!request) return json({ error: "request_not_found", detail: `No job row matches id ${requestId}. If this job clearly exists, the function is likely reading a different project or its SUPABASE_SERVICE_ROLE_KEY isn't a true service-role key (so RLS hides the row).`, request_id: requestId }, 404);
    if ((request as any).client_id !== user.id) return json({ error: "not_your_request", detail: "This job belongs to a different account." }, 403);

    // DEDUP — never create a second live hold/charge for a job that already has one. A double-tap or
    // a re-open of the pay sheet must not put two authorizations on the client's card.
    const { data: existing } = await admin
      .from("payments").select("id, status").eq("request_id", requestId).in("status", ["authorized", "captured"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) return json({ error: "already_paid", detail: (existing as any).status === "captured" ? "This job is already paid." : "This job already has a payment hold — no new charge was created.", status: (existing as any).status }, 409);

    const { data: items, error: itemsErr } = await admin
      .from("request_items").select("type, rate, qty, price_mode").eq("request_id", requestId);
    if (itemsErr) return json({ error: "items_lookup_failed", detail: itemsErr.message, request_id: requestId }, 500);
    const list = (items as any[]) || [];

    // FEE MODEL (must mirror capture-payment):
    //   labour (hourly): client pays rate×hours; worker keeps 90% (10% platform fee).
    //   task (job-priced): client pays price + a flat $3 booking per spot; worker keeps 100%.
    //   travel + tip: added on top, 100% to the worker.
    const TASK_FEE_CENTS = Math.max(0, Math.round(Number(Deno.env.get("TASK_FLAT_FEE") || "300")));
    const hours = Number((request as any).duration_hours) || 4;
    let cents = 0;
    for (const it of list) {
      const rate = Number(it.rate) || 0;
      const qty = Number(it.qty) || 1;
      const isTask = it.price_mode === "job";
      cents += isTask
        ? (Math.round(rate * 100) + TASK_FEE_CENTS) * qty   // task price + booking, per spot
        : Math.round(rate * hours * 100) * qty;             // hourly
    }
    const travelCents = Math.max(0, Math.round(Number((request as any).travel_cents) || 0));
    const tipCents = Math.max(0, Math.floor(Number(body?.tip_cents) || 0));
    cents += travelCents + tipCents;
    if (cents < 100) return json({ error: "amount_too_small", detail: "Nothing to charge on this job yet." }, 400);

    const label = `SiteCall — ${list[0]?.type || "Job"}${list.length > 1 ? ` +${list.length - 1} more` : ""}`;
    const successUrl = Deno.env.get("STRIPE_SUCCESS_URL") || "https://example.com/paid?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl = Deno.env.get("STRIPE_CANCEL_URL") || "https://example.com/cancelled";

    // Create the Checkout Session via Stripe's REST API (no SDK needed — robust in Deno).
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", successUrl);
    form.set("cancel_url", cancelUrl);
    form.set("client_reference_id", requestId);
    form.set("metadata[request_id]", requestId);
    form.set("metadata[client_id]", user.id);
    // HOLD, don't charge: authorize the funds now, capture when the client approves the work
    // (release if the job's cancelled). This is the marketplace-correct model.
    form.set("payment_intent_data[capture_method]", "manual");
    form.set("payment_intent_data[metadata][request_id]", requestId);
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "aud");
    form.set("line_items[0][price_data][unit_amount]", String(cents));
    form.set("line_items[0][price_data][product_data][name]", label);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const session = await res.json();
    if (!res.ok) return json({ error: "stripe_error", detail: session?.error?.message || `HTTP ${res.status}` }, 502);

    // Record it (service-role write; clients can't touch this table).
    await admin.from("payments").insert({
      request_id: requestId,
      client_id: user.id,
      amount_cents: cents,
      currency: "aud",
      tip_cents: tipCents,
      travel_cents: travelCents,
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent || null,
      status: "pending",
    });

    return json({ url: session.url, session_id: session.id, amount_cents: cents });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
