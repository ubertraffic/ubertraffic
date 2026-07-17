// PayJobSheet.js — the client's payment moment. A polished bottom sheet: job summary, the amount,
// a secure "Pay with Stripe" button, then a seamless auto-confirm when they return from the hosted
// page (no manual "I've paid" tap — an AppState listener re-checks on foreground). Reusable: drop it
// anywhere (e.g. the approve flow) by passing a requestId. Test-mode badged so it's obvious no real
// money moves. Card details never touch the app — Stripe's hosted page handles them.
//
// Props: visible, requestId, label, estimateCents, onClose(), onPaid()
import React, { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Animated, AppState, Linking } from 'react-native';
import { C, S, R, T, shadowSm } from './theme';
import { startJobCheckout, checkJobPayment, latestPaymentFor } from './paymentsService';

const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function PayJobSheet({ visible, requestId, label, estimateCents, onClose, onPaid }) {
  const [phase, setPhase] = useState('intro');   // intro | opening | waiting | paid | error
  const [amount, setAmount] = useState(estimateCents || 0);
  const [session, setSession] = useState(null);
  const [err, setErr] = useState('');
  const check = useRef(new Animated.Value(0)).current;

  // Reset each time it opens; if this job is already paid, jump straight to the paid state.
  useEffect(() => {
    if (!visible) return;
    setPhase('intro'); setErr(''); setSession(null); setAmount(estimateCents || 0);
    (async () => {
      const p = await latestPaymentFor(requestId).catch(() => null);
      if (p && p.status === 'paid') { setAmount(p.amount_cents); setPhase('paid'); }
    })();
  }, [visible, requestId, estimateCents]);

  // Seamless confirm: when the app returns to the foreground after we opened Stripe, re-check.
  useEffect(() => {
    if (!visible || !session) return;
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') confirm(); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session]);

  useEffect(() => {
    if (phase !== 'paid') return;
    check.setValue(0);
    Animated.spring(check, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [phase, check]);

  async function pay() {
    setPhase('opening'); setErr('');
    try {
      const r = await startJobCheckout(requestId);   // computes amount server-side + opens the hosted page
      if (r?.amount_cents) setAmount(r.amount_cents);
      setSession(r.session_id);
      setPhase('waiting');
    } catch (e) { setErr(e.message || String(e)); setPhase('error'); }
  }

  async function confirm() {
    try {
      const r = await checkJobPayment(session);
      if (r?.paid) { setPhase('paid'); onPaid && onPaid(); }
    } catch (_) { /* leave it in waiting; the manual re-check button stays available */ }
  }

  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grip} />

          {phase === 'paid' ? (
            <View style={{ alignItems: 'center', paddingBottom: 8 }}>
              <Animated.View style={[s.check, { transform: [{ scale: check }] }]}><Text style={s.checkT}>✓</Text></Animated.View>
              <Text style={s.paidTitle}>Payment received</Text>
              <Text style={s.paidAmt}>{money(amount)}</Text>
              <Text style={s.paidSub}>{label || 'Job'} · paid securely</Text>
              <TouchableOpacity style={s.primary} onPress={onClose} activeOpacity={0.9}><Text style={s.primaryT}>Done</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={s.head}>
                <Text style={s.title}>Pay for this job</Text>
                <View style={s.testPill}><Text style={s.testPillT}>TEST MODE</Text></View>
              </View>

              <View style={s.jobCard}>
                <Text style={s.jobLabel} numberOfLines={1}>{label || 'Job'}</Text>
                <Text style={s.amt}>{money(amount)}</Text>
                <Text style={s.amtSub}>Estimated total{amount ? '' : ' — confirmed at checkout'}</Text>
              </View>

              <View style={s.secureRow}>
                <Text style={{ fontSize: 15 }}>🔒</Text>
                <Text style={s.secureT}>Card details are handled by Stripe — they never touch SiteCall.</Text>
              </View>

              {phase === 'waiting' ? (
                <>
                  <View style={s.waitBox}>
                    <ActivityIndicator color={C.indigo} />
                    <Text style={s.waitT}>Finish paying on the Stripe page. We’ll confirm automatically when you come back.</Text>
                  </View>
                  <TouchableOpacity style={s.primary} onPress={confirm} activeOpacity={0.9}><Text style={s.primaryT}>I’ve paid — check now</Text></TouchableOpacity>
                  <TouchableOpacity style={s.ghost} onPress={() => Linking.openURL(`https://checkout.stripe.com`).catch(() => {})} activeOpacity={0.7}><Text style={s.ghostT}>Re-open payment page</Text></TouchableOpacity>
                </>
              ) : (
                <>
                  {!!err && <Text style={s.err}>{err}</Text>}
                  <TouchableOpacity style={[s.primary, phase === 'opening' && { opacity: 0.6 }]} disabled={phase === 'opening'} onPress={pay} activeOpacity={0.9}>
                    <Text style={s.primaryT}>{phase === 'opening' ? 'Opening…' : `Pay ${amount ? money(amount) + ' ' : ''}securely`}</Text>
                  </TouchableOpacity>
                  <Text style={s.testHint}>Test card 4242 4242 4242 4242 · any future date · any CVC</Text>
                </>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(12,12,20,0.5)' },
  sheet: { backgroundColor: C.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 34 },
  grip: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, alignSelf: 'center', marginBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '900', color: C.ink, letterSpacing: -0.4 },
  testPill: { backgroundColor: C.amber + '22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  testPillT: { color: C.amber, fontWeight: '900', fontSize: 10.5, letterSpacing: 0.5 },
  jobCard: { backgroundColor: C.panel, borderRadius: R.lg, padding: 18, alignItems: 'center', ...shadowSm },
  jobLabel: { fontSize: 14, fontWeight: '700', color: C.mute, marginBottom: 6 },
  amt: { fontSize: 40, fontWeight: '900', color: C.ink, letterSpacing: -1 },
  amtSub: { fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 4 },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingHorizontal: 4 },
  secureT: { flex: 1, fontSize: 12.5, color: C.mute, lineHeight: 17, fontWeight: '600' },
  primary: { backgroundColor: C.indigo, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 18 },
  primaryT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  ghost: { paddingVertical: 12, alignItems: 'center' },
  ghostT: { color: C.mute, fontWeight: '700', fontSize: 13.5 },
  testHint: { fontSize: 11.5, color: C.mute2, textAlign: 'center', marginTop: 12, fontWeight: '600' },
  waitBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: R.md, padding: 14, marginTop: 16 },
  waitT: { flex: 1, fontSize: 13, color: C.mute, lineHeight: 18, fontWeight: '600' },
  err: { color: C.red, fontSize: 13, marginTop: 14, textAlign: 'center' },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 16 },
  checkT: { color: '#fff', fontSize: 38, fontWeight: '900', lineHeight: 42 },
  paidTitle: { fontSize: 15, fontWeight: '800', color: C.green, letterSpacing: 0.3 },
  paidAmt: { fontSize: 40, fontWeight: '900', color: C.ink, letterSpacing: -1, marginTop: 6 },
  paidSub: { fontSize: 13, color: C.mute, fontWeight: '600', marginTop: 6 },
});
