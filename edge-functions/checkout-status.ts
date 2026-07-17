// checkout-status — Supabase Edge Function. Given a Checkout Session id, asks Stripe whether it's
// paid and syncs the `payments` row. The app calls this after the client returns from the hosted
// page (a lightweight stand-in for a webhook while we're on Snack; a signed webhook is the
// production-grade follow-up). Secret key stays server-side.
//
// Deploy: Supabase → Edge Functions → new function 'checkout-status' → paste → Deploy.
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
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = (body?.session_id || "").toString();
    if (!sessionId) return json({ error: "missing_session_id" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Only let the caller check a session that belongs to one of their own payment rows.
    const { data: pay } = await admin
      .from("payments").select("id, client_id").eq("stripe_session_id", sessionId).maybeSingle();
    if (!pay || (pay as any).client_id !== user.id) return json({ error: "not_your_payment" }, 403);

    // Expand the PaymentIntent: with manual capture the session's payment_status stays 'unpaid'
    // until capture, so the PI status is the source of truth (requires_capture = held/authorized).
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const session = await res.json();
    if (!res.ok) return json({ error: "stripe_error", detail: session?.error?.message || `HTTP ${res.status}` }, 502);

    const pi = session.payment_intent && typeof session.payment_intent === "object" ? session.payment_intent : null;
    const piStatus = pi?.status || null;
    let status = "pending";
    if (piStatus === "requires_capture") status = "authorized";       // funds held
    else if (piStatus === "succeeded") status = "captured";           // money taken
    else if (piStatus === "canceled") status = "released";            // hold released
    else if (session.status === "expired") status = "cancelled";

    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (pi?.id) patch.stripe_payment_intent = pi.id;
    await admin.from("payments").update(patch).eq("stripe_session_id", sessionId);

    return json({ status, authorized: status === "authorized", captured: status === "captured", pi_status: piStatus });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
