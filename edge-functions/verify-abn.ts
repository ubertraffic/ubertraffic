// verify-abn — Supabase Edge Function. Verifies the caller's stored ABN against the FREE
// ABR ABN Lookup register. The GUID lives here (secret ABR_GUID), never in the app.
// Mirrors verify-credential: auth -> fetch register -> name-match -> write abn_status='verified'.
// Deploy from the Supabase dashboard (Edge Functions -> new function 'verify-abn' -> paste -> Deploy).
// Secret required: ABR_GUID (free from https://abr.business.gov.au/Documentation/WebServiceRegistration).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ABR_JSON = "https://abr.business.gov.au/json/AbnDetails.aspx";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function nameLooksLikeMatch(registered: string, opName: string): boolean {
  if (!registered || !opName) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const a = new Set(norm(registered));
  const b = norm(opName);
  if (b.length === 0) return false;
  return b.filter((w) => a.has(w)).length >= 1;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "not_authenticated" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: prof } = await admin
      .from("profiles").select("id, abn, legal_name, full_name, name").eq("id", user.id).maybeSingle();

    const abn = ((prof as any)?.abn || "").replace(/\D/g, "");
    if (!/^\d{11}$/.test(abn)) return json({ status: "review", detail: "No valid ABN on file to verify." });
    const opName = ((prof as any)?.legal_name || (prof as any)?.full_name || (prof as any)?.name || "").toString();

    const guid = Deno.env.get("ABR_GUID");
    if (!guid) return json({ status: "review", detail: "Missing ABR GUID." });

    const res = await fetch(`${ABR_JSON}?abn=${abn}&guid=${encodeURIComponent(guid)}`);
    if (!res.ok) return json({ status: "review", detail: `ABR error ${res.status}` });

    // ABR may return JSONP: callback({...}). Try bare JSON first, then unwrap.
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch (_) {
      const m = text.match(/^[\w$]+\((.*)\)\s*;?\s*$/s);
      if (m) { try { data = JSON.parse(m[1]); } catch (_) { /* ignore */ } }
    }
    if (!data) return json({ status: "review", detail: "Could not read ABR response." });
    if (data.Message) return json({ status: "review", detail: `ABR: ${data.Message}` });

    const abnStatus = (data.AbnStatus || "").toString().toLowerCase();
    if (!abnStatus.includes("active")) return json({ status: "review", detail: `ABN is not active (${data.AbnStatus || "unknown"}).` });

    const bizNames = Array.isArray(data.BusinessName) ? data.BusinessName.join(" ") : (data.BusinessName || "");
    const registered = `${data.EntityName || ""} ${bizNames}`.trim();
    if (opName && !nameLooksLikeMatch(registered, opName)) {
      return json({ status: "review", detail: "ABN is active, but the name needs manual confirmation." });
    }

    const { error: upErr } = await admin.from("profiles").update({ abn_status: "verified" }).eq("id", user.id);
    if (upErr) return json({ status: "review", detail: "Verified at ABR but DB update failed." });

    return json({ status: "verified", detail: `Matched ${data.EntityName || "the ABR record"}.` });
  } catch (e) {
    return json({ status: "review", detail: `Unexpected: ${(e as Error).message}` });
  }
});
