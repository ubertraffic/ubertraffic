// stripe-webhook — the SOURCE OF TRUTH for payment state. Stripe calls this directly (server→server),
// so payment status is recorded even if the client closes the app after paying. Verifies the Stripe
// signature (HMAC-SHA256) so only Stripe can post here. The app's checkout-status polling stays as a
// UX accelerator, but this is what makes the money flow reliable.
//
// Deploy: Supabase → Edge Functions → new function 'stripe-webhook' → paste → Deploy.
//   IMPORTANT: turn OFF "Verify JWT" for this function (Stripe can't send a Supabase JWT).
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (the 'whsec_…' from the Stripe webhook endpoint),
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// In Stripe → Developers → Webhooks → add endpoint = this function's URL, listening to:
//   checkout.session.completed, payment_intent.amount_capturable_updated, payment_intent.succeeded,
//   payment_intent.canceled, payment_intent.payment_failed, charge.refunded.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Constant-time-ish hex compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// Verify the Stripe-Signature header. signed_payload = `${t}.${rawBody}`; v1 = HMAC-SHA256 hex.
async function verify(rawBody: string, sigHeader: string, secret: string, toleranceSec = 300): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = parts["t"]; const v1 = parts["v1"];
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;   // replay guard
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, v1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!whSecret) return json({ error: "webhook_not_configured" }, 500);

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  if (!(await verify(raw, sig, whSecret))) return json({ error: "bad_signature" }, 400);

  let event: any;
  try { event = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const obj = event?.data?.object || {};

  // Map the request/payment-intent this event is about.
  const piId: string | null = obj?.payment_intent || (event.type?.startsWith("payment_intent") ? obj?.id : null) || null;
  const sessionId: string | null = event.type === "checkout.session.completed" ? obj?.id : null;
  const requestId: string | null = obj?.metadata?.request_id || obj?.client_reference_id || null;

  // Choose the new local status from the event.
  let status: string | null = null;
  switch (event.type) {
    case "checkout.session.completed":
      // For manual capture the PI is now authorized (held) once the session completes.
      status = "authorized"; break;
    case "payment_intent.amount_capturable_updated":
      status = "authorized"; break;
    case "payment_intent.succeeded":
      status = "captured"; break;
    case "payment_intent.canceled":
      status = "released"; break;
    case "payment_intent.payment_failed":
      status = "failed"; break;
    case "charge.refunded":
      status = "refunded"; break;
    default:
      return json({ received: true, ignored: event.type });   // ack anything we don't handle
  }

  // Locate the payment row by PI, then session, then request — whichever we have.
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  let q = admin.from("payments").update(patch);
  if (piId) q = q.eq("stripe_payment_intent", piId);
  else if (sessionId) q = q.eq("stripe_session_id", sessionId);
  else if (requestId) q = q.eq("request_id", requestId);
  else return json({ received: true, note: "no key to match a payment row" });

  const { error } = await q;
  // Never 500 back to Stripe for a transient DB blip on a status we've recorded elsewhere — but do
  // surface a real failure so Stripe retries.
  if (error) return json({ error: "db_update_failed", detail: error.message }, 500);
  return json({ received: true, type: event.type, status });
});
