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

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const session = await res.json();
    if (!res.ok) return json({ error: "stripe_error", detail: session?.error?.message || `HTTP ${res.status}` }, 502);

    // payment_status: 'paid' | 'unpaid' | 'no_payment_required'
    const paid = session.payment_status === "paid";
    const status = paid ? "paid" : (session.status === "expired" ? "cancelled" : "pending");
    await admin.from("payments")
      .update({ status, stripe_payment_intent: session.payment_intent || null, updated_at: new Date().toISOString() })
      .eq("stripe_session_id", sessionId);

    return json({ status, paid, payment_status: session.payment_status });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
