// PayoutsScreen.js — the worker sets up payouts (Stripe Connect Express). Onboarding happens on
// Stripe's hosted page; we just open it and read back the status. Self-contained. Props: onClose()
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { payoutStatus, startPayoutOnboarding } from './paymentsService';
import { C, S, R, T, shadowSm } from './theme';

export default function PayoutsScreen({ onClose }) {
  const [status, setStatus] = useState(null);   // null=loading, {} object
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setStatus(await payoutStatus()); } catch (e) { setMsg(e.message || String(e)); setStatus({}); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Re-check when the worker returns from Stripe's onboarding page.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  async function setup() {
    setBusy(true); setMsg('');
    try { await startPayoutOnboarding(); }
    catch (e) { setMsg(e.message || String(e)); }
    finally { setBusy(false); }
  }

  const ready = status?.payouts_enabled;
  const started = status && status.details_submitted;

  return (
    <View style={s.screen}>
      <View style={s.head}>
        {onClose && <TouchableOpacity onPress={onClose}><Text style={s.back}>‹ Done</Text></TouchableOpacity>}
        <Text style={s.h1}>Payouts</Text>
        <Text style={s.tier}>Get paid straight to your bank after a job’s approved.</Text>
      </View>
      <View style={{ padding: S.xl }}>
        {status == null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 20 }} /> : (
          <>
            <View style={[s.card, { borderColor: ready ? C.green : C.line, borderWidth: 1 }]}>
              <View style={s.statusRow}>
                <View style={[s.dot, { backgroundColor: ready ? C.green : started ? C.amber : C.mute }]} />
                <Text style={s.statusT}>
                  {ready ? 'Ready to receive payouts' : started ? 'Almost there — a few details still needed' : 'Not set up yet'}
                </Text>
              </View>
              <Text style={s.body}>
                {ready
                  ? 'Your payout account is active. When a client approves your completed job, your pay lands in your bank automatically.'
                  : 'Set up your payout account with Stripe (our payments partner) — it takes a couple of minutes. Your bank details are entered on Stripe’s secure page, never in SiteCall.'}
              </Text>
            </View>

            {!ready && (
              <TouchableOpacity style={[s.primary, busy && { opacity: 0.6 }]} disabled={busy} onPress={setup} activeOpacity={0.9}>
                <Text style={s.primaryT}>{busy ? 'Opening…' : started ? 'Continue payout setup' : 'Set up payouts'}</Text>
              </TouchableOpacity>
            )}

            {/* Diagnostic — what Stripe actually reports, so a stuck "not ready" is debuggable, not a mystery. */}
            {status && (status.account_id || status.disabled_reason || (status.currently_due && status.currently_due.length)) ? (
              <View style={s.diag}>
                <Text style={s.diagLine}>payouts_enabled: <Text style={{ fontWeight: '800', color: status.payouts_enabled ? C.green : C.red }}>{String(!!status.payouts_enabled)}</Text>   ·   charges_enabled: {String(!!status.charges_enabled)}</Text>
                {status.account_id ? <Text style={s.diagLine}>account: {status.account_id}</Text> : null}
                {status.disabled_reason ? <Text style={[s.diagLine, { color: C.red }]}>disabled_reason: {status.disabled_reason}</Text> : null}
                {status.currently_due && status.currently_due.length
                  ? <Text style={[s.diagLine, { color: C.amber }]}>Stripe needs now: {status.currently_due.join(', ')}</Text>
                  : <Text style={s.diagLine}>Nothing currently due (any listed items are future/threshold only).</Text>}
              </View>
            ) : null}
            {ready && (
              <TouchableOpacity style={s.ghost} onPress={setup} disabled={busy} activeOpacity={0.8}>
                <Text style={s.ghostT}>Update payout details</Text>
              </TouchableOpacity>
            )}
            {!!msg && <Text style={s.err}>{msg}</Text>}
            <Text style={s.note}>Powered by Stripe. SiteCall never sees or stores your bank details.</Text>
          </>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  head: { paddingHorizontal: S.xl, paddingTop: 22, paddingBottom: 16 },
  back: { color: C.mute, fontWeight: '700', fontSize: 14, marginBottom: 12 },
  h1: { fontSize: 27, fontWeight: '900', letterSpacing: -0.7, color: C.ink },
  tier: { fontSize: 13, color: C.mute, marginTop: 4, lineHeight: 18 },
  card: { backgroundColor: C.panel, borderRadius: R.lg, padding: 16, ...shadowSm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusT: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  body: { fontSize: 13.5, color: C.mute, lineHeight: 19 },
  primary: { backgroundColor: C.indigo, borderRadius: R.lg, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  primaryT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  ghost: { paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  ghostT: { color: C.indigo, fontWeight: '700', fontSize: 14 },
  err: { color: C.red, fontSize: 13, marginTop: 12, textAlign: 'center' },
  note: { fontSize: 11.5, color: C.mute2, textAlign: 'center', marginTop: 20, lineHeight: 16 },
  diag: { marginTop: 16, padding: 12, borderRadius: R.md, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, gap: 4 },
  diagLine: { fontSize: 11.5, color: C.mute, lineHeight: 16 },
});
