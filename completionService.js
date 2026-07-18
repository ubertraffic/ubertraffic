// completionService.js — shift lifecycle + settlement data layer
import { supabase } from './supabaseClient';
import { releasePayment } from './paymentsService';

// Operator: move my assignment forward (accepted->en_route->on_site->complete)
export async function advanceAssignment(assignmentId, to) {
  const { data, error } = await supabase.rpc('advance_assignment', {
    p_assignment_id: assignmentId, p_to: to,
  });
  if (error) throw error;
  return data;
}

// Operator: geofenced arrival. Captures GPS; server hard-blocks if >300m from site.
export async function checkIn(assignmentId, lat, lng, override = false, reason = null) {
  const { data, error } = await supabase.rpc('check_in', {
    p_assignment_id: assignmentId, p_lat: lat, p_lng: lng,
    p_override: override, p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// Operator: completion with GPS proof + optional photo.
export async function checkOut(assignmentId, lat, lng, photoUrl = null) {
  const { data, error } = await supabase.rpc('check_out', {
    p_assignment_id: assignmentId, p_lat: lat, p_lng: lng, p_photo_url: photoUrl,
  });
  if (error) throw error;
  return data;
}

// Operator: report finishing when a clean check-out didn't happen (phone died / GPS lost).
// Moves the job into reconciliation; someone signs off, or it auto-settles on booked hours.
export async function reportMissedCheckout(assignmentId, claimedEnd) {
  const { data, error } = await supabase.rpc('report_missed_checkout', {
    p_assignment_id: assignmentId,
    p_claimed_end: claimedEnd || new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

// Client / site contact: confirm the actual end time of a shift under reconciliation.
export async function resolveReconciliation(assignmentId, endAt, by = 'client') {
  const { data, error } = await supabase.rpc('resolve_reconciliation', {
    p_assignment_id: assignmentId,
    p_end_at: endAt,
    p_by: by,
  });
  if (error) throw error;
  return data;
}

// Operator: submit a materials claim (reimbursement). Receipt required over $30 or it needs
// client approval; over the cap also needs approval. Server enforces — this just submits.
export async function submitMaterialClaim(assignmentId, amount, receiptUrl = null, note = null) {
  const { data, error } = await supabase.rpc('submit_material_claim', {
    p_assignment_id: assignmentId,
    p_amount: amount,
    p_receipt_url: receiptUrl,
    p_note: note,
  });
  if (error) throw error;
  return data;
}

// Client: approve or reject a flagged material claim.
export async function resolveMaterialClaim(claimId, approve) {
  const { data, error } = await supabase.rpc('resolve_material_claim', {
    p_claim_id: claimId,
    p_approve: approve,
  });
  if (error) throw error;
  return data;
}

// Read material claims for a request (client review) or assignment (worker view).
export async function listMaterialClaims(requestId) {
  const { data, error } = await supabase
    .from('material_claims')
    .select('id, assignment_id, amount, receipt_url, note, status, needs_approval, created_at')
    .eq('request_id', requestId)
    .order('created_at');
  if (error) return [];
  return data || [];
}

// Client: approve a fully-complete request -> computes settlement.
// Optional upward adjustments (all >= 0, 100% to worker, no platform fee): travel, tip,
// bonus, extraHours. Omitted = 0. This is the ONLY approve path (unified settlement core).
export async function approveRequest(requestId, adj = {}) {
  const { data, error } = await supabase.rpc('approve_request', {
    p_request_id: requestId,
    p_travel: adj.travel || 0,
    p_tip: adj.tip || 0,
    p_bonus: adj.bonus || 0,
    p_extra_hours: adj.extraHours || 0,
  });
  if (error) throw error;
  return data;
}

// Client: cancel a whole request (any stage before settlement). Also release any Stripe hold so a
// card authorization is never left dangling (best-effort — a cancel must succeed even if release does
// not; release-payment is a no-op when there's nothing authorized to void).
export async function cancelRequest(requestId, reason = null) {
  const { data, error } = await supabase.rpc('cancel_request', {
    p_request_id: requestId, p_reason: reason,
  });
  if (error) throw error;
  try { await releasePayment(requestId); } catch (_) { /* no hold to release, or offline — the cancel still stands */ }
  return data;
}

// Operator: explicitly begin travelling (committed -> en_route). Passes real GPS
// so the server computes an honest distance-based ETA (no fabricated number).
export async function startJourney(assignmentId, lat = null, lng = null) {
  const { data, error } = await supabase.rpc('start_journey', {
    p_assignment_id: assignmentId, p_lat: lat, p_lng: lng,
  });
  if (error) throw error;
  return data;
}

// Client: re-post a cancelled/stale request as a fresh open job.
export async function repostRequest(requestId) {
  const { data, error } = await supabase.rpc('repost_request', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}

// Operator: withdraw from / abort my assignment.
export async function cancelAssignment(assignmentId, reason = null) {
  const { data, error } = await supabase.rpc('cancel_assignment', {
    p_assignment_id: assignmentId, p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// Client: list my requests WITH their assignments (to show progress + approve)
export async function listMyRequestsFull() {
  // The client's home/approve surface must be THIS account's truth only. We scope
  // explicitly to client_id = auth.uid() rather than trusting RLS alone — a money
  // action (approve & pay) must never surface another account's job even if an RLS
  // policy is later loosened by mistake. Defence in depth (CLAUDE.md §1).
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('requests')
    .select(`
      id, status, when_type, address_text, duration_hours, created_at,
      approved_at, settle_total, settle_fee, settle_net,
      request_items (
        id, kind, type, qty, rate, rate_offered, price_mode, trade_id,
        assignments (
          id, status, operator_id, spot_index, accepted_at, journey_started_at, eta_baseline_min, start_dist_m, live_dist_m, live_at,
          job_events ( kind, to_status, distance_m, context, created_at )
        )
      )
    `)
    .eq('client_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];

  // enrich operators SEPARATELY so a profile that RLS can't read never drops a
  // request row (embeds can filter parents; a separate fetch cannot).
  const opIds = [...new Set(rows.flatMap((r) =>
    (r.request_items || []).flatMap((it) =>
      (it.assignments || []).map((a) => a.operator_id).filter(Boolean))))];
  if (opIds.length) {
    try {
      const { data: ops } = await supabase
        .from('profiles')
        .select('id, full_name, rating, rating_count, jobs_done, vehicle_type')
        .in('id', opIds);
      const byId = Object.fromEntries((ops || []).map((o) => [o.id, o]));
      rows.forEach((r) => (r.request_items || []).forEach((it) => (it.assignments || []).forEach((a) => {
        a.operator = byId[a.operator_id] || null;
      })));
    } catch (_) { /* operator names optional — never block the list */ }
  }
  return rows;
}

// Real job markers for the home map (extracted coords + live status).
export async function getMapJobs() {
  const { data, error } = await supabase.rpc('my_map_jobs');
  if (error) throw error;
  return (data || []).map((j) => ({
    requestId: j.request_id,
    lat: j.lat, lng: j.lng, label: j.label, status: j.status, sub: j.sub,
    workerLat: j.worker_lat, workerLng: j.worker_lng, workerName: j.worker_name,
    assignedName: j.assigned_name, assignedStatus: j.assigned_status,
    crewSize: j.crew_size, crewSummary: j.crew_summary,
  }));
}

// Operator pings their live location for an en_route assignment (sampled ~15s).
export async function updateMyLocation(assignmentId, lat, lng) {
  const { error } = await supabase.rpc('update_my_location', {
    p_assignment_id: assignmentId, p_lat: lat, p_lng: lng,
  });
  if (error) throw error;
}

// The operator's own active job sites (where they're heading) for their map.
export async function getOperatorMapJobs() {
  const { data, error } = await supabase.rpc('my_operator_map_jobs');
  if (error) throw error;
  return (data || []).map((j) => ({
    lat: j.lat, lng: j.lng, label: j.label, status: j.status, sub: j.sub,
  }));
}

// ── Tracker ─────────────────────────────────────────────────────────────────
// The unified glanceable job state — one source of truth that every real-time
// surface renders (in-app card now; push + Live Activity later). Server-computed.
export async function getTrackerState(requestId, perspective = 'client') {
  const { data, error } = await supabase.rpc('job_tracker_state', { p_request_id: requestId, p_perspective: perspective });
  if (error) throw error;
  return data;   // { exists, stage, headline, moment, detail, next_step, seen, confidence, ... }
}
