// requestsService.js
// The data layer for requests. Screens call these functions — they never talk
// to supabase directly. Keeps DB logic in one place (service layer per the rules).

import { supabase } from './supabaseClient';

/**
 * Create a request plus its items, in the right order.
 * items: [{ kind:'gear'|'crew'|'task', type, qty, hire:'wet'|'dry'|null, tickets:[] }]
 * Returns the new request id.
 *
 * Note: this is a two-step insert (request, then items). In production this
 * becomes a single server-side Edge Function / RPC so it's atomic and the
 * server validates everything. For now the RLS policies still protect it:
 * a user can only insert a request as themselves, and items only under their
 * own request.
 */
export async function createRequest({ when_type, address_text, lat, lng, duration_hours, items, scheduled_for = null, siteContact = null, materialsCap = 0, jobDetails = null }) {
  // basic client-side guards (server-side validation comes with the Edge Fn later)
  if (!items || items.length === 0) throw new Error('Add at least one item first.');
  if (!address_text || !address_text.trim()) throw new Error('Enter a site location.');
  // schema contract: when_type enum is ('now','scheduled'); a scheduled job MUST have
  // scheduled_at (DB check: when_type='now' OR scheduled_at IS NOT NULL).
  if (when_type === 'scheduled' && !scheduled_for) throw new Error('Pick a day and time for a scheduled job.');

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const uid = userData.user.id;

  // Site contact: whoever's actually on site. If the client didn't name someone, THEY are
  // the contact (link to their own user id so they can sign off hours themselves later).
  const contactName = (siteContact && siteContact.name && siteContact.name.trim()) || null;
  const contactPhone = (siteContact && siteContact.phone && siteContact.phone.trim()) || null;
  const contactIsClient = !contactName && !contactPhone;

  // 1) insert the request
  const { data: reqRows, error: reqErr } = await supabase
    .from('requests')
    .insert({
      client_id: uid,
      when_type,
      address_text: address_text.trim(),
      duration_hours,
      scheduled_at: when_type === 'scheduled' ? scheduled_for : null,
      site_contact_name: contactName,
      site_contact_phone: contactPhone,
      // link to a user only when the client is the contact (they can sign off in-app).
      // A named third-party contact links to a user later if/when they're matched.
      site_contact_user_id: contactIsClient ? uid : null,
      materials_cap: Math.max(0, Number(materialsCap) || 0),
      // duties / what the worker will actually do — shown to workers before they accept.
      // Normalise empty/whitespace to null so blank briefs stay clean nulls, not "".
      job_details: (jobDetails && jobDetails.trim()) ? jobDetails.trim() : null,
    })
    .select('id')
    .single();
  if (reqErr) throw reqErr;

  const requestId = reqRows.id;

  // store the site coordinates (from the picked address) so the geofence works.
  if (lat != null && lng != null) {
    const { error: locErr } = await supabase.rpc('set_request_location', {
      p_request_id: requestId, p_lat: lat, p_lng: lng,
    });
    if (locErr) throw locErr;
  }

  // 2) insert the items for that request
  const itemRows = items.map((it) => ({
    request_id: requestId,
    kind: it.kind,
    type: it.type,
    trade_id: it.trade_id || null,
    qty: it.qty || 1,
    rate: it.rate != null ? it.rate : null,
    price_mode: it.priceMode || (it.kind === 'task' ? 'job' : 'hour'),
    hire: it.kind === 'gear' ? (it.hire || 'wet') : null,
    tickets: it.kind === 'crew' ? (it.tickets || []) : [],
  }));

  const { error: itemErr } = await supabase.from('request_items').insert(itemRows);
  if (itemErr) {
    // best-effort rollback: remove the orphaned request so we don't leave junk
    await supabase.from('requests').delete().eq('id', requestId);
    throw itemErr;
  }

  return requestId;
}

/** List the current user's requests, newest first, with their items. */
export async function listMyRequests() {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('requests')
    .select('id, status, when_type, address_text, duration_hours, created_at, request_items ( id, kind, type, qty, hire )')
    .eq('client_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// --- Live dispatch status for the "finding operators" screen ---
// Returns, for a request: how many operators were notified (dispatches),
// how many spots are needed, and how many are filled (assignments).
export async function getRequestLiveStatus(requestId) {
  // items + needed qty
  const { data: items, error: iErr } = await supabase
    .from('request_items')
    .select('id, type, qty')
    .eq('request_id', requestId);
  if (iErr) throw iErr;

  const itemIds = (items || []).map((i) => i.id);
  const needed = (items || []).reduce((n, i) => n + (i.qty || 1), 0);
  if (itemIds.length === 0) return { notified: 0, needed: 0, filled: 0, items: [] };

  // notified = distinct operators dispatched across this request's items
  const { data: disp } = await supabase
    .from('dispatches')
    .select('operator_id, request_item_id')
    .in('request_item_id', itemIds);
  const notified = new Set((disp || []).map((d) => d.operator_id)).size;

  // filled = assignments across this request's items
  const { data: asg } = await supabase
    .from('assignments')
    .select('id, request_item_id, status')
    .in('request_item_id', itemIds);
  const filled = (asg || []).length;

  // per-item fill for the nice list
  const perItem = (items || []).map((it) => ({
    type: it.type,
    qty: it.qty || 1,
    filled: (asg || []).filter((a) => a.request_item_id === it.id).length,
  }));

  return { notified, needed, filled, items: perItem };
}
