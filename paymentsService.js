// paymentsService.js — the ONE place the app touches payments. It never sees the Stripe secret
// key: it asks the create-checkout Edge Function (which holds the secret) for a hosted-payment URL,
// opens it, then confirms via checkout-status. Snack-compatible (no native Stripe SDK).
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';

// Invoke an Edge Function WITH the user's access token explicitly attached. supabase.functions.invoke
// doesn't always forward the session (it can fall back to the anon key → the function sees no user
// and 401s 'not_authenticated'), so we pass the token by hand — the reliable fix.
async function invoke(fn, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.functions.invoke(fn, {
    body: body || {},
    headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
  });
  if (error) {
    let detail = error.message || String(error);
    try { if (error.context?.json) { const b = await error.context.json(); if (b?.error || b?.detail) detail = b.detail || b.error; } } catch (_) {}
    throw new Error(detail);
  }
  return data;
}

// Ask the server to build a Checkout Session for a job (amount computed SERVER-SIDE from the
// request), then open Stripe's hosted payment page. Returns { url, session_id, amount_cents }.
export async function startJobCheckout(requestId, tipCents = 0) {
  const data = await invoke('create-checkout', { request_id: requestId, tip_cents: Math.max(0, Math.floor(tipCents || 0)) });
  if (!data?.url) throw new Error('Could not start the payment.');
  await Linking.openURL(data.url);
  return data;   // { url, session_id, amount_cents }
}

// After the client returns from the hosted page, confirm the payment state.
export async function checkJobPayment(sessionId) {
  return (await invoke('checkout-status', { session_id: sessionId })) || { status: 'pending' };
}

// Client approves the work → capture the held funds and pay out the worker(s).
export async function capturePayment(requestId) {
  return invoke('capture-payment', { request_id: requestId });
}
// Job cancelled before capture → release the hold.
export async function releasePayment(requestId) {
  return invoke('release-payment', { request_id: requestId });
}

// ── Worker payouts (Stripe Connect) ──────────────────────────────────────────
// Start/continue payout setup — opens Stripe's hosted onboarding. Returns after opening.
export async function startPayoutOnboarding() {
  const data = await invoke('connect-onboard', {});
  if (!data?.url) throw new Error('Could not open payout setup.');
  await Linking.openURL(data.url);
  return data;
}
// Is this worker ready to receive payouts? { onboarded, payouts_enabled, details_submitted }.
export async function payoutStatus() {
  return invoke('connect-status', {});
}

// Worker payout controls (all act on the caller's own Stripe account) — balance + schedule, change
// the standard schedule, or cash out instantly for a fee.
export async function payoutBalance() {
  return invoke('payout-actions', { action: 'balance' });
}
export async function setPayoutSchedule(interval) {
  return invoke('payout-actions', { action: 'schedule', interval });
}
export async function instantPayout() {
  return invoke('payout-actions', { action: 'instant' });
}

// Worker: my payout ledger — the ACTUAL Stripe transfers (not inferred from settlement columns).
// Worker-readable via RLS (operator_id = auth.uid()). Surfaces real status: paid / pending / failed,
// so a payout that didn't land (e.g. account not ready) shows the truth instead of looking "paid".
export async function listMyPayouts() {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, request_id, assignment_id, amount_cents, currency, status, detail, created_at')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

// Client: the payment record (the Stripe charge) behind a job — for a real receipt. Client-readable
// via RLS (client_id = auth.uid()). Returns the latest row for the request, or null.
export async function getPaymentForRequest(requestId) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount_cents, currency, status, stripe_payment_intent, tip_cents, travel_cents, created_at, updated_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return data || null;
}

// The most recent payment on a request (client-readable) — for showing state without a poll.
export async function latestPaymentFor(requestId) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount_cents, currency, status, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;   // never break the UI on a read
  return data || null;
}
