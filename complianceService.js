// complianceService.js — site compliance data layer (prestart/SWMS, photo proof, sign-off).
//
// Wraps the compliance RPCs + Supabase Storage behind one clean service (CLAUDE.md:
// external APIs behind a service layer). Every capture lands as an append-only
// job_events row via a SECURITY DEFINER RPC — the client never writes job_events
// directly. Photos go to Storage; only their URL is recorded.
//
// Honest-degradation rule (CLAUDE.md unhappy paths): a photo that won't upload must
// NOT block a worker from finishing real work — callers can catch the upload error,
// queue locally, and complete with proof pending. But compliance is never marked done
// when it wasn't captured: the server gate (compliance_ready) reads real job_events.

import { supabase } from './supabaseClient';

const PROOF_BUCKET = 'job-proof';

// ---- requirements + gate (reads) -------------------------------------------

// What does this trade require? Returns the trade_compliance row, or null if the
// trade isn't in the table (caller should treat unknown as "completion photo only").
export async function getTradeRequirements(type) {
  if (!type) return null;
  const { data, error } = await supabase
    .from('trade_compliance')
    .select('*')
    .eq('type', type)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// The gate: is this assignment cleared to complete? Returns { ready, missing[], trade }.
// The completion UI consults this; it reads real captured events server-side.
export async function complianceReady(assignmentId) {
  const { data, error } = await supabase.rpc('compliance_ready', {
    p_assignment_id: assignmentId,
  });
  if (error) throw error;
  return data; // jsonb: { ready: bool, missing: [...], trade: '...' }
}

// ---- prestart / SWMS (write) -----------------------------------------------

// Record the reg-291 trigger answers + SWMS acknowledgment. The SERVER decides HRCW
// and raises 'swms_required' if a high-risk trigger is ticked without swms_ack — so a
// caller must surface the SWMS step when this throws that code.
//   triggers: { road_traffic, mobile_plant, fall_over_2m, asbestos_demo } (booleans)
export async function submitPrestart(assignmentId, triggers, swmsAck, lat = null, lng = null) {
  const { error } = await supabase.rpc('submit_prestart', {
    p_assignment_id: assignmentId,
    p_triggers: triggers || {},
    p_swms_ack: !!swmsAck,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) throw error;
  return true;
}

// Pure client-side helper: does this set of trigger answers make the job HRCW?
// Mirrors the server rule so the UI can reveal the SWMS step live, before submit.
export function triggersAreHRCW(triggers) {
  if (!triggers) return false;
  return !!(triggers.road_traffic || triggers.mobile_plant || triggers.fall_over_2m || triggers.asbestos_demo);
}

// ---- photo proof (upload + write) ------------------------------------------

// Upload a proof photo to Storage, then record it. Two steps so a caller can catch
// the UPLOAD failure separately (queue for retry) from the RECORD failure.
//   fileUri: local uri from the camera; kind: 'arrival' | 'completion'.
// Returns { url } on success.
export async function uploadAndRecordPhoto(assignmentId, fileUri, kind, { lat = null, lng = null, distanceM = null } = {}) {
  const url = await uploadProofPhoto(assignmentId, fileUri, kind);
  await recordProofPhoto(assignmentId, url, kind, { lat, lng, distanceM });
  return { url };
}

// Upload only — returns the stored path/URL. Throws on network/storage failure so the
// caller can decide to queue-and-continue rather than block completion.
export async function uploadProofPhoto(assignmentId, fileUri, kind) {
  const stamp = Date.now();
  const path = `${assignmentId}/${kind}-${stamp}.jpg`;
  // React Native fetch->blob is the reliable way to get bytes from a local uri.
  const res = await fetch(fileUri);
  const blob = await res.blob();
  const { error } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path; // store the path; signed/public URL resolved on read
}

// Record an already-uploaded photo against the assignment (writes the job_events row).
export async function recordProofPhoto(assignmentId, url, kind, { lat = null, lng = null, distanceM = null } = {}) {
  const { error } = await supabase.rpc('submit_proof_photo', {
    p_assignment_id: assignmentId,
    p_photo_url: url,
    p_photo_kind: kind,
    p_lat: lat,
    p_lng: lng,
    p_distance_m: distanceM,
  });
  if (error) throw error;
  return true;
}

// Resolve a stored proof path to a viewable signed URL (bucket is private).
export async function proofPhotoUrl(path, expiresSec = 3600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(PROOF_BUCKET)
    .createSignedUrl(path, expiresSec);
  if (error) throw error;
  return data?.signedUrl || null;
}

// ---- sign-off (write) ------------------------------------------------------

// Record a signature. signer: 'worker' | 'client'. Model supports remote client
// sign-off (client signs from their own device) — same RPC, signer='client'.
export async function submitSignoff(assignmentId, signer, typedName = null, lat = null, lng = null) {
  const { error } = await supabase.rpc('submit_signoff', {
    p_assignment_id: assignmentId,
    p_signer: signer,
    p_typed_name: typedName,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) throw error;
  return true;
}

// ---- safety record (read helper) -------------------------------------------

// Parse the job_events already embedded on an assignment (from listMyRequestsFull) into a
// display-ready safety record for the client sign-off screen. Pure/read-only — no new fetch.
// This is a SHARED RECORD of what was captured on site; it is NOT a safety guarantee.
export function safetyRecordFromEvents(events) {
  const evs = Array.isArray(events) ? events : [];
  const prestartEv = evs.find((e) => e.kind === 'prestart');
  const photos = evs
    .filter((e) => e.kind === 'photo' && e.context && e.context.photo_url)
    .map((e) => ({ path: e.context.photo_url, kind: e.context.photo_kind || null, at: e.created_at }));
  const signoffs = evs.filter((e) => e.kind === 'signoff');
  const workerSignoff = signoffs.find((e) => e.context && e.context.signer === 'worker') || null;
  const clientSignoff = signoffs.find((e) => e.context && e.context.signer === 'client') || null;
  const checkin = evs.find((e) => e.kind === 'checkin');
  return {
    prestart: prestartEv ? {
      triggers: (prestartEv.context && prestartEv.context.triggers) || {},
      hrcw: !!(prestartEv.context && prestartEv.context.hrcw),
      swmsAck: !!(prestartEv.context && prestartEv.context.swms_ack),
      at: prestartEv.created_at,
    } : null,
    photos,
    checkin: checkin ? {
      flagged: !!(checkin.context && checkin.context.flagged),
      gpsOverride: !!(checkin.context && checkin.context.override),
      at: checkin.created_at,
    } : null,
    workerSignoff: workerSignoff ? { name: (workerSignoff.context && workerSignoff.context.typed_name) || null, at: workerSignoff.created_at } : null,
    clientSignoff: clientSignoff ? { name: (clientSignoff.context && clientSignoff.context.typed_name) || null, at: clientSignoff.created_at } : null,
  };
}
