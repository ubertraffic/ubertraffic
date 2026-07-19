// AcceptCelebration.js — the "You're on" recap shown the moment a worker locks a spot (and a lighter
// "Job done" beat on completion). PURELY PRESENTATION: it fires AFTER acceptSpot() has already
// succeeded server-side. Deliberately NOT a "it's a match" confetti moment — it's a calm, confident
// confirmation that lays out everything the worker needs on site, in one screenshot-worthy card.
// Driven by `data` ({ type, qty, rate, priceMode, hours, suburb, address, urgent, scheduledAt,
// jobDetails, variant }); null = hidden.
import React, { useEffect, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { C, R, T } from './theme';
import Icon from './Icon';

function whenLine(data) {
  if (data.urgent) return 'Now — starting soon';
  if (data.scheduledAt) {
    const d = new Date(data.scheduledAt);
    const day = d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    const h = d.getHours(); const hr = h % 12 || 12; const ap = h < 12 ? 'am' : 'pm';
    const mins = d.getMinutes();
    return `${day} · ${hr}${mins ? ':' + String(mins).padStart(2, '0') : ''}${ap}`;
  }
  return 'Booked';
}

export default function AcceptCelebration({ data, onDone }) {
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!data) return;
    scale.setValue(0.92); opacity.setValue(0); badge.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 120, useNativeDriver: true }),
      Animated.spring(badge, { toValue: 1, friction: 5, tension: 100, delay: 120, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function close() {
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => onDone && onDone());
  }

  if (!data) return null;
  const isDone = data.variant === 'complete';
  const isJob = data.priceMode === 'job';
  const rateStr = data.rate ? `$${data.rate}${isJob ? '/job' : '/hr'}` : null;
  const est = (data.rate && !isJob && data.hours) ? `≈ $${Math.round(data.rate * data.hours).toLocaleString()} for the ${data.hours}h job` : null;

  // Keep it to three rows so the whole card fits one screen (hours already live in the Pay sub-line).
  const rows = isDone
    ? [data.suburb && { icon: 'pin', label: 'Where', value: data.suburb }].filter(Boolean)
    : [
        rateStr && { icon: 'payment', label: 'Pay', value: rateStr, sub: est },
        { icon: 'calendar', label: 'When', value: whenLine(data) },
        (data.suburb || data.address) && { icon: 'pin', label: 'Where', value: data.suburb || data.address },
      ].filter(Boolean);

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[s.scrim, { opacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
        <Animated.View style={[s.card, { opacity, transform: [{ scale }] }]}>
          {/* brand marker — makes the card recognisably SiteCall in a screenshot */}
          <View style={s.brandRow}>
            <View style={s.mark}><Icon name="pin" size={12} color="#fff" strokeWidth={2.6} /></View>
            <Text style={s.brandT}>SiteCall</Text>
          </View>

          <Animated.View style={[s.badge, { transform: [{ scale: badge }] }]}>
            <Icon name="check" size={30} color="#fff" strokeWidth={3} />
          </Animated.View>
          <Text style={s.kicker}>{isDone ? 'NICE WORK' : (data.urgent ? "YOU'RE ON · STARTING NOW" : "YOU'RE ON")}</Text>
          <Text style={s.title}>{isDone ? 'Job done!' : "You've got the job"}</Text>
          <Text style={s.job} numberOfLines={2}>{data.type || 'the job'}{data.qty > 1 ? ` · ${data.qty} spots` : ''}</Text>

          {rows.length > 0 && (
            <View style={s.rows}>
              {rows.map((row, i) => (
                <View key={row.label} style={[s.row, i > 0 && s.rowDiv]}>
                  <View style={s.rowIcon}><Icon name={row.icon} size={15} color={C.mute} strokeWidth={2.2} /></View>
                  <Text style={s.rowLabel}>{row.label}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowValue} numberOfLines={1}>{row.value}</Text>
                    {row.sub ? <Text style={s.rowSub}>{row.sub}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          )}

          {!isDone && data.jobDetails ? (
            <Text style={s.duties} numberOfLines={2}>“{data.jobDetails}”</Text>
          ) : null}

          <TouchableOpacity style={s.cta} onPress={close} activeOpacity={0.9}>
            <Text style={s.ctaT}>Got it</Text>
          </TouchableOpacity>
          <Text style={s.hint}>{isDone ? 'Payment’s on the way once it’s approved' : 'Saved to your Jobs — chat, map & check-in are there'}</Text>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(12,12,20,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, backgroundColor: C.panel, borderRadius: 26, paddingVertical: 24, paddingHorizontal: 22, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  mark: { width: 20, height: 20, borderRadius: 6, backgroundColor: C.indigo, alignItems: 'center', justifyContent: 'center' },
  brandT: { fontSize: 13, fontWeight: '800', color: C.ink, letterSpacing: -0.2 },
  badge: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: C.green, textAlign: 'center' },
  title: { fontSize: 25, fontWeight: '900', color: C.ink, letterSpacing: -0.6, marginTop: 6, textAlign: 'center' },
  job: { fontSize: 16, fontWeight: '700', color: C.ink2 || C.ink, marginTop: 6, textAlign: 'center' },
  rows: { alignSelf: 'stretch', backgroundColor: C.panel2, borderRadius: 16, marginTop: 18, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  rowDiv: { borderTopWidth: 1, borderTopColor: C.line },
  rowIcon: { width: 24, alignItems: 'center' },
  rowLabel: { fontSize: 12.5, fontWeight: '700', color: C.mute, width: 46 },
  rowValue: { fontSize: 14.5, fontWeight: '800', color: C.ink, textAlign: 'right' },
  rowSub: { fontSize: 11.5, fontWeight: '700', color: C.green, textAlign: 'right', marginTop: 1 },
  duties: { fontSize: 13, fontStyle: 'italic', color: C.mute, lineHeight: 18, marginTop: 14, textAlign: 'center' },
  cta: { alignSelf: 'stretch', backgroundColor: C.ink, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  ctaT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hint: { fontSize: 12, color: C.mute, marginTop: 12, fontWeight: '600', textAlign: 'center' },
});
