// paymentsService.js — the ONE place the app touches payments. It never sees the Stripe secret
// key: it asks the create-checkout Edge Function (which holds the secret) for a hosted-payment URL,
// opens it, then confirms via checkout-status. Snack-compatible (no native Stripe SDK).
import { Linking } from 'react-native';
import { supabase } from './supabaseClient';

// Ask the server to build a Checkout Session for a job (amount computed SERVER-SIDE from the
// request), then open Stripe's hosted payment page. Returns { url, session_id, amount_cents }.
export async function startJobCheckout(requestId) {
  const { data, error } = await supabase.functions.invoke('create-checkout', { body: { request_id: requestId } });
  if (error) {
    let detail = error.message || String(error);
    try { if (error.context?.json) { const b = await error.context.json(); if (b?.error || b?.detail) detail = b.detail || b.error; } } catch (_) {}
    throw new Error(detail);
  }
  if (!data?.url) throw new Error('Could not start the payment.');
  await Linking.openURL(data.url);
  return data;   // { url, session_id, amount_cents }
}

// After the client returns from the hosted page, confirm whether it was paid. Returns
// { status: 'paid'|'pending'|'cancelled', paid: bool }.
export async function checkJobPayment(sessionId) {
  const { data, error } = await supabase.functions.invoke('checkout-status', { body: { session_id: sessionId } });
  if (error) {
    let detail = error.message || String(error);
    try { if (error.context?.json) { const b = await error.context.json(); if (b?.error || b?.detail) detail = b.detail || b.error; } } catch (_) {}
    throw new Error(detail);
  }
  return data || { status: 'pending', paid: false };
}

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body: body || {} });
  if (error) {
    let detail = error.message || String(error);
    try { if (error.context?.json) { const b = await error.context.json(); if (b?.error || b?.detail) detail = b.detail || b.error; } } catch (_) {}
    throw new Error(detail);
  }
  return data;
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
