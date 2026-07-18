// release-payment — the job's cancelled before capture, so we CANCEL the held PaymentIntent and the
// authorization drops off the client's card. Only the client who owns the request can release.
// Deploy as 'release-payment'. Secret: STRIPE_SECRET_KEY.
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
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const requestId = (body?.request_id || "").toString();
    if (!requestId) return json({ error: "missing_request_id" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Release ANY non-terminal hold — 'pending' (paid on Stripe but our webhook/poll hasn't flipped it
    // to 'authorized' yet) as well as 'authorized'. A real hold can exist while the row says 'pending',
    // so cancelling only 'authorized' would leave the card authorization dangling.
    const { data: pay } = await admin
      .from("payments").select("id, client_id, status, stripe_payment_intent, stripe_session_id")
      .eq("request_id", requestId).in("status", ["pending", "authorized"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!pay) return json({ released: false, detail: "No hold to release (nothing pending or authorized)." }, 200);
    if ((pay as any).client_id !== user.id) return json({ error: "not_your_request" }, 403);

    // Resolve the PaymentIntent: the stored one, or from the Checkout Session (pending rows created at
    // session time may not have a PI stored yet).
    let piId = (pay as any).stripe_payment_intent;
    if (!piId && (pay as any).stripe_session_id) {
      const sRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent((pay as any).stripe_session_id)}`, { headers: { Authorization: `Bearer ${secret}` } });
      const s = await sRes.json();
      piId = s?.payment_intent || null;
    }
    if (!piId) { // never charged (no PI ever created) — just mark it released locally
      await admin.from("payments").update({ status: "released", updated_at: new Date().toISOString() }).eq("id", (pay as any).id);
      return json({ released: true, note: "no_payment_intent" });
    }

    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/cancel`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}` },
    });
    const pi = await res.json();
    // Already captured/canceled → treat as resolved, don't error (the hold is not dangling either way).
    if (!res.ok && pi?.error?.code !== "payment_intent_unexpected_state") {
      return json({ error: "release_failed", detail: pi?.error?.message || "cancel error" }, 502);
    }

    await admin.from("payments").update({ status: "released", updated_at: new Date().toISOString() }).eq("id", (pay as any).id);
    return json({ released: true });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
