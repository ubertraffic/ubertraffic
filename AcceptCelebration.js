// AcceptCelebration.js — the "it's a match!" moment when a worker locks a spot.
// PURELY PRESENTATION. It fires AFTER acceptSpot() has already succeeded server-side (the
// atomic accept-lock is untouched) — this is just the celebration of that result. Driven by a
// `data` prop ({ type, rate, suburb, urgent }); null = hidden. Auto-dismisses, or tap to continue.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Animated, Easing, StyleSheet } from 'react-native';
import { C } from './theme';

const CONFETTI = [C.indigo, C.green, C.amber || '#F5A623', '#FF5A79', '#3DA5FF', '#F5A623'];

export default function AcceptCelebration({ data, onDone }) {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(0)).current;

  // confetti pieces — generated once; each has an angle/distance/colour to burst outward
  const [pieces] = useState(() => Array.from({ length: 18 }, (_, i) => ({
    key: i,
    angle: (Math.PI * 2 * i) / 18 + (Math.random() - 0.5) * 0.5,
    dist: 90 + Math.random() * 140,
    color: CONFETTI[i % CONFETTI.length],
    size: 7 + Math.random() * 8,
    delay: Math.random() * 140,
  }));
  const conf = useRef(pieces.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!data) return;
    scale.setValue(0.6); opacity.setValue(0); badge.setValue(0);
    conf.forEach((v) => v.setValue(0));
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      Animated.spring(badge, { toValue: 1, friction: 4, tension: 90, delay: 130, useNativeDriver: true }),
      Animated.parallel(conf.map((v, i) => Animated.timing(v, {
        toValue: 1, duration: 950, delay: pieces[i].delay, easing: Easing.out(Easing.quad), useNativeDriver: true,
      }))),
    ]).start();
    const t = setTimeout(close, 2900);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  function close() {
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => onDone && onDone());
  }

  if (!data) return null;
  const isDone = data.variant === 'complete';
  const rate = data.rate ? `$${data.rate}/hr` : null;
  const kicker = isDone ? 'NICE WORK' : (data.urgent ? "IT'S A MATCH · URGENT" : "IT'S A MATCH");
  const title = isDone ? 'Job done!' : "You're in!";

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View style={[s.scrim, { opacity }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} />
        <View style={s.wrap} pointerEvents="box-none">
          {pieces.map((p, i) => {
            const tx = conf[i].interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.angle) * p.dist] });
            const ty = conf[i].interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(p.angle) * p.dist - 30] });
            const o = conf[i].interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] });
            return (
              <Animated.View key={p.key} pointerEvents="none" style={{
                position: 'absolute', top: '42%', left: '50%', width: p.size, height: p.size, borderRadius: 2,
                backgroundColor: p.color, opacity: o, transform: [{ translateX: tx }, { translateY: ty }],
              }} />
            );
          })}

          <Animated.View style={[s.card, { opacity, transform: [{ scale }] }]}>
            <Animated.View style={[s.badge, { transform: [{ scale: badge }] }]}>
              <Text style={s.badgeT}>✓</Text>
            </Animated.View>
            <Text style={s.kicker}>{kicker}</Text>
            <Text style={s.title}>{title}</Text>
            <Text style={s.job} numberOfLines={2}>{data.type || 'the job'}</Text>
            {(!isDone && (rate || data.suburb)) ? (
              <View style={s.metaRow}>
                {rate ? <View style={s.chip}><Text style={s.chipT}>{rate}</Text></View> : null}
                {data.suburb ? <View style={s.chip}><Text style={s.chipT}>{data.suburb}</Text></View> : null}
              </View>
            ) : null}
            {isDone && data.suburb ? (
              <View style={s.metaRow}><View style={s.chip}><Text style={s.chipT}>{data.suburb}</Text></View></View>
            ) : null}
            <TouchableOpacity style={s.cta} onPress={close} activeOpacity={0.9}>
              <Text style={s.ctaT}>{isDone ? 'Done' : 'Let’s go →'}</Text>
            </TouchableOpacity>
            <Text style={s.hint}>{isDone ? 'Payment’s on the way once it’s approved' : 'Your spot is locked in'}</Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(12,12,20,0.72)', alignItems: 'center', justifyContent: 'center' },
  wrap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  card: { width: 300, backgroundColor: C.panel, borderRadius: 26, paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 24 },
  badge: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  badgeT: { color: '#fff', fontSize: 36, fontWeight: '900', lineHeight: 40 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: C.green },
  title: { fontSize: 30, fontWeight: '900', color: C.ink, letterSpacing: -0.6, marginTop: 6 },
  job: { fontSize: 17, fontWeight: '700', color: C.ink, marginTop: 8, textAlign: 'center' },
  metaRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },
  chip: { backgroundColor: C.indigo + '14', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 },
  chipT: { color: C.indigo, fontWeight: '800', fontSize: 13 },
  cta: { backgroundColor: C.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40, marginTop: 22 },
  ctaT: { color: '#fff', fontWeight: '800', fontSize: 15 },
  hint: { fontSize: 12, color: C.mute, marginTop: 12, fontWeight: '600' },
});
