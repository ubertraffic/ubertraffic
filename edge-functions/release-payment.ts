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
    const { data: pay } = await admin
      .from("payments").select("id, client_id, status, stripe_payment_intent")
      .eq("request_id", requestId).eq("status", "authorized")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!pay) return json({ error: "no_held_payment", detail: "No held payment to release." }, 404);
    if ((pay as any).client_id !== user.id) return json({ error: "not_your_request" }, 403);
    const piId = (pay as any).stripe_payment_intent;
    if (!piId) return json({ error: "no_payment_intent" }, 400);

    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/cancel`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}` },
    });
    const pi = await res.json();
    if (!res.ok) return json({ error: "release_failed", detail: pi?.error?.message || "cancel error" }, 502);

    await admin.from("payments").update({ status: "released", updated_at: new Date().toISOString() }).eq("id", (pay as any).id);
    return json({ released: true });
  } catch (e) {
    return json({ error: "server_error", detail: (e as Error)?.message || String(e) }, 500);
  }
});
