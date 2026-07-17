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
import { startJobCheckout, checkJobPayment, latestPaymentFor, capturePayment } from './paymentsService';

const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function PayJobSheet({ visible, requestId, label, estimateCents, autoCapture, onClose, onPaid }) {
  const [phase, setPhase] = useState('intro');   // intro | opening | waiting | held | paid | error
  const [amount, setAmount] = useState(estimateCents || 0);
  const [tipCents, setTipCents] = useState(0);   // client tip — 100% to the worker
  const [session, setSession] = useState(null);
  const [err, setErr] = useState('');
  const check = useRef(new Animated.Value(0)).current;

  // Reset each time it opens; if this job already has a hold/capture, jump straight to that state.
  useEffect(() => {
    if (!visible) return;
    setPhase('intro'); setErr(''); setSession(null); setAmount(estimateCents || 0); setTipCents(0);
    (async () => {
      const p = await latestPaymentFor(requestId).catch(() => null);
      if (p && p.status === 'captured') { setAmount(p.amount_cents); setPhase('paid'); }
      else if (p && p.status === 'authorized') { setAmount(p.amount_cents); setPhase('held'); }
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
    if (phase !== 'paid' && phase !== 'held') return;
    check.setValue(0);
    Animated.spring(check, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [phase, check]);

  async function pay() {
    setPhase('opening'); setErr('');
    try {
      const r = await startJobCheckout(requestId, tipCents);   // amount computed server-side + opens hosted page
      if (r?.amount_cents) setAmount(r.amount_cents);
      setSession(r.session_id);
      setPhase('waiting');
    } catch (e) { setErr(e.message || String(e)); setPhase('error'); }
  }

  async function confirm() {
    try {
      const r = await checkJobPayment(session);
      if (r?.captured) { setPhase('paid'); onPaid && onPaid(); }
      else if (r?.authorized) { setPhase('held'); }   // onPaid fires only on capture (below)
    } catch (_) { /* leave it in waiting; the manual re-check button stays available */ }
  }

  // Capture the hold + pay out the worker(s). This is the "approve the work" moment; kept in the
  // sheet so the whole hold → capture → payout flow is testable in one place.
  const [capturing, setCapturing] = useState(false);
  async function approveAndPay() {
    setCapturing(true); setErr('');
    try { await capturePayment(requestId); setPhase('paid'); onPaid && onPaid(); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setCapturing(false); }
  }

  // In the approval flow, once the hold is secured we capture + pay the worker automatically,
  // so the client experiences ONE smooth payment rather than a two-step secure-then-approve.
  useEffect(() => {
    if (phase === 'held' && autoCapture && !capturing) approveAndPay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, autoCapture]);

  return (
    <Modal visible={!!visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grip} />

          {(phase === 'paid' || phase === 'held') ? (
            <View style={{ alignItems: 'center', paddingBottom: 8 }}>
              <Animated.View style={[s.check, { transform: [{ scale: check }] }]}><Text style={s.checkT}>✓</Text></Animated.View>
              <Text style={s.paidTitle}>{phase === 'paid' ? 'Payment complete' : 'Payment secured'}</Text>
              <Text style={s.paidAmt}>{money(amount)}</Text>
              <Text style={s.paidSub}>
                {phase === 'paid'
                  ? `${label || 'Job'} · paid & released to the worker`
                  : `${label || 'Job'} · held securely — charged when you approve the work`}
              </Text>
              {!!err && <Text style={s.err}>{err}</Text>}
              {phase === 'held' ? (
                <TouchableOpacity style={[s.primary, capturing && { opacity: 0.6 }]} disabled={capturing} onPress={approveAndPay} activeOpacity={0.9}>
                  <Text style={s.primaryT}>{capturing ? 'Paying…' : 'Approve & pay worker'}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={s.ghost} onPress={onClose} activeOpacity={0.9}><Text style={s.ghostT}>Done</Text></TouchableOpacity>
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
                <Text style={s.amtSub}>{amount ? 'Held until you approve the work' : 'Confirmed at checkout'}</Text>
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
                  {/* Tip — optional, 100% to the worker */}
                  <Text style={s.tipLabel}>Add a tip? <Text style={s.tipHint}>100% goes to the worker</Text></Text>
                  <View style={s.tipRow}>
                    {[0, 500, 1000, 2000].map((c) => (
                      <TouchableOpacity key={c} style={[s.tipChip, tipCents === c && s.tipChipOn]} onPress={() => setTipCents(c)} activeOpacity={0.85}>
                        <Text style={[s.tipChipT, tipCents === c && s.tipChipTOn]}>{c === 0 ? 'No tip' : `$${c / 100}`}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {!!err && <Text style={s.err}>{err}</Text>}
                  <TouchableOpacity style={[s.primary, phase === 'opening' && { opacity: 0.6 }]} disabled={phase === 'opening'} onPress={pay} activeOpacity={0.9}>
                    <Text style={s.primaryT}>{phase === 'opening' ? 'Opening…' : `Pay ${money((amount || 0) + tipCents)} securely`}</Text>
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
  tipLabel: { fontSize: 13, fontWeight: '800', color: C.ink, marginTop: 18, marginBottom: 8 },
  tipHint: { fontSize: 12, fontWeight: '600', color: C.green },
  tipRow: { flexDirection: 'row', gap: 8 },
  tipChip: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  tipChipOn: { borderColor: C.indigo, backgroundColor: C.indigo + '10' },
  tipChipT: { fontSize: 13.5, fontWeight: '700', color: C.mute },
  tipChipTOn: { color: C.indigo },
  waitBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: R.md, padding: 14, marginTop: 16 },
  waitT: { flex: 1, fontSize: 13, color: C.mute, lineHeight: 18, fontWeight: '600' },
  err: { color: C.red, fontSize: 13, marginTop: 14, textAlign: 'center' },
  check: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 16 },
  checkT: { color: '#fff', fontSize: 38, fontWeight: '900', lineHeight: 42 },
  paidTitle: { fontSize: 15, fontWeight: '800', color: C.green, letterSpacing: 0.3 },
  paidAmt: { fontSize: 40, fontWeight: '900', color: C.ink, letterSpacing: -1, marginTop: 6 },
  paidSub: { fontSize: 13, color: C.mute, fontWeight: '600', marginTop: 6 },
});
