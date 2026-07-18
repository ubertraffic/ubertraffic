// operatorService.js
// Data layer for the operator side. Screens call these; no direct supabase in UI.

import { supabase } from './supabaseClient';

/** Flip the current user's role and online state, optionally set a vehicle. */
export async function setRole(role) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', u.user.id);
  if (error) throw error;
}

export async function setOnline(isOnline) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ is_online: isOnline })
    .eq('id', u.user.id);
  if (error) throw error;
}

/** Record the operator's current location (called when they go online). Best-effort. */
export async function setMyOperatorLocation(lat, lng) {
  if (lat == null || lng == null) throw new Error('No coordinates to set.');
  const { error } = await supabase.rpc('set_my_operator_location', { p_lat: lat, p_lng: lng });
  if (error) throw error;
}

/** Anonymous DEMAND heat — locations of active jobs near a point (coords only). */
export async function getDemandHeat(lat, lng, radiusKm = 40) {
  if (lat == null || lng == null) return [];
  const { data, error } = await supabase.rpc('demand_heat', { p_lat: lat, p_lng: lng, p_radius_km: radiusKm });
  if (error) throw error;
  return (data || []).map((d) => ({ lat: d.lat, lng: d.lng }));
}

/** Anonymous coverage near a point — count + approx points for the map glow. */
export async function getOperatorCoverage(lat, lng, radiusKm = 25) {
  if (lat == null || lng == null) return { n: 0, points: [] };
  const { data, error } = await supabase.rpc('operator_coverage', { p_lat: lat, p_lng: lng, p_radius_km: radiusKm });
  if (error) throw error;
  const row = (data && data[0]) || { n: 0, points: [] };
  return { n: row.n || 0, points: row.points || [] };
}

export async function setVehicle(vehicleType) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('profiles')
    .update({ vehicle_type: vehicleType })
    .eq('id', u.user.id);
  if (error) throw error;
}

/** Read my own profile (role, online, vehicle, name) so the UI reflects real state. */
export async function getMyProfile() {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, is_online, vehicle_type, rating, rating_count, full_name, account_type, can_work, can_task, can_hire, worker_verify_status, company_verify_status, abn, abn_status, legal_name, date_of_birth')
    .eq('id', u.user.id)
    .single();
  if (error) throw error;
  return data;
}

/** Set my display name — used across the app for personalisation + the job room. */
export async function updateMyName(fullName) {
  const { data: u } = await supabase.auth.getUser();
  const name = (fullName || '').trim().slice(0, 80);
  if (!name) throw new Error('Name cannot be empty');
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: name })
    .eq('id', u.user.id);
  if (error) throw error;
  return name;
}

/** Declare a capability (what this operator can supply), e.g. crew/Traffic controller. */
export async function addCapability(kind, type, trade_id = null) {
  const { data: u } = await supabase.auth.getUser();
  // Never store a capability without a trade_id — orphaned rows silently stop matching under
  // group-aware dispatch. If the caller didn't supply one, resolve it from the trade name.
  let resolvedTradeId = trade_id;
  if (!resolvedTradeId && type) {
    const { data: t } = await supabase.from('trades').select('id').eq('name', type).limit(1).maybeSingle();
    resolvedTradeId = t?.id || null;
  }
  const { error } = await supabase
    .from('operator_capabilities')
    .upsert(
      { operator_id: u.user.id, kind, type, trade_id: resolvedTradeId, wet: true, dry: false, crew_size: 1 },
      { onConflict: 'operator_id,kind,type' }
    );
  if (error) throw error;
}

export async function listMyCapabilities() {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in — please log in again.');
  const { data, error } = await supabase
    .from('operator_capabilities')
    .select('id, kind, type, trade_id')
    .eq('operator_id', u.user.id);
  if (error) throw error;
  return data || [];
}

/** Remove one of my capabilities. */
export async function removeCapability(id) {
  const { data: u } = await supabase.auth.getUser();
  if (!u || !u.user) throw new Error('Not signed in — please log in again.');
  const { error } = await supabase
    .from('operator_capabilities')
    .delete()
    .eq('id', id)
    .eq('operator_id', u.user.id); // belt and braces: only ever my own
  if (error) throw error;
}

/**
 * Jobs I've been dispatched to and haven't actioned yet.
 * We read dispatches (status sent/seen) and join the item + request for display,
 * plus how many spots are left on each item.
 */
export async function listMyDispatches() {
  const { data: u } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('dispatches')
    .select(`
      id, status,
      request_item:request_items (
        id, kind, type, qty, hire, rate, rate_offered, price_mode,
        request:requests ( id, address_text, when_type, duration_hours, scheduled_at, job_details )
      )
    `)
    .eq('operator_id', u.user.id)
    .in('status', ['sent', 'seen'])
    .order('sent_at', { ascending: false });
  if (error) throw error;

  // For each item, how many spots already taken (to show "x of y left").
  const rows = data || [];
  const withCounts = await Promise.all(rows.map(async (d) => {
    const itemId = d.request_item?.id;
    let taken = 0;
    let mine_accepted = 0;
    if (itemId) {
      const { count } = await supabase
        .from('assignments')
        .select('id', { count: 'exact', head: true })
        .eq('request_item_id', itemId)
        .neq('status', 'cancelled');
      taken = count || 0;
      const { count: mineCount } = await supabase
        .from('assignments')
        .select('id', { count: 'exact', head: true })
        .eq('request_item_id', itemId)
        .eq('operator_id', u.user.id)
        .neq('status', 'cancelled');
      mine_accepted = mineCount || 0;
    }
    return { ...d, taken, mine_accepted };
  }));
  return withCounts;
}

/** Accept a spot — fires the atomic accept-lock RPC. Returns the assignment. */
export async function acceptSpot(itemId) {
  const { data, error } = await supabase.rpc('accept_spot', { p_item_id: itemId });
  if (error) throw error;               // e.g. 'no_spots_left', 'not_dispatched'
  return data;
}

/** Jobs I've accepted (my assignments). */
export async function listMyAssignments() {
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('assignments')
    .select(`
      id, status, accepted_at, paid_at, completed_at, net_amount, gross_amount, fee_amount,
      reconcile_state, reconcile_deadline, claimed_end_at,
      request_item:request_items (
        type, kind, rate, rate_offered, price_mode, trade_id,
        trade:trades ( run_style ),
        request:requests ( id, client_id, address_text, when_type, duration_hours, scheduled_at, job_details, completion_state, review_deadline, settle_net, site_contact_name, site_contact_phone, materials_cap, pickup_text )
      )
    `)
    .eq('operator_id', u.user.id)
    .order('accepted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
