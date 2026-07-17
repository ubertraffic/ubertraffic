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

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // The request must exist AND belong to the caller — never let someone pay against a job they don't own.
    const { data: request } = await admin
      .from("requests").select("id, client_id, duration_hours, address_text").eq("id", requestId).maybeSingle();
    if (!request) return json({ error: "request_not_found" }, 404);
    if ((request as any).client_id !== user.id) return json({ error: "not_your_request" }, 403);

    const { data: items } = await admin
      .from("request_items").select("type, rate, qty, price_mode").eq("request_id", requestId);
    const list = (items as any[]) || [];

    // SERVER-AUTHORITATIVE amount: sum rate × qty × hours (job-priced items count as 1 unit).
    const hours = Number((request as any).duration_hours) || 4;
    let cents = 0;
    for (const it of list) {
      const rate = Number(it.rate) || 0;
      const qty = Number(it.qty) || 1;
      const units = it.price_mode === "job" ? 1 : hours;
      cents += Math.round(rate * qty * units * 100);
    }
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
      stripe_session_id: session.id,
      stripe_payment_intent: session.payment_intent || null,
      status: "pending",
    });

    return json({ url: session.url, session_id: session.id, amount_cents: cents });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
