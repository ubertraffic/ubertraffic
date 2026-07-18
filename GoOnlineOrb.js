// GoOnlineOrb.js — the Work side's signature "go online" control (Uber "Go" DNA, in green).
// OFFLINE: a big breathing green orb. Press-and-HOLD to confirm — an inner ring charges up over
// ~500ms with haptics (touch → mid-tick → success), then fires onConfirm. Lifting early cancels
// safely, so a stray tap never puts you online. ONLINE: the orb becomes a slim status pill with a
// live dot, your suburb and a running earnings ticker; tap it to go offline.
// Pure core Animated + expo-haptics (via the shared `tap`), no svg / no gradient deps.
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { C } from './theme';
import { tap } from './components2';

const HOLD_MS = 520;

export default function GoOnlineOrb({ online, busy, onConfirm, onGoOffline, suburb, earningsToday, onlineSince }) {
  const halo = useRef(new Animated.Value(0)).current;   // idle breathing
  const fill = useRef(new Animated.Value(0)).current;    // hold-to-confirm charge
  const press = useRef(new Animated.Value(0)).current;   // press-down scale
  const midTick = useRef(null);
  const [holding, setHolding] = useState(false);
  const [nowTick, setNowTick] = useState(0);   // 1s heartbeat so the online timer counts up live

  useEffect(() => {
    if (!online || !onlineSince) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [online, onlineSince]);

  // idle breathing halo (offline only)
  useEffect(() => {
    if (online) { halo.stopAnimation(); return; }
    const loop = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: 1700, easing: Easing.out(Easing.ease), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [online]);

  const cancelHold = () => {
    if (midTick.current) { clearTimeout(midTick.current); midTick.current = null; }
    setHolding(false);
    Animated.parallel([
      Animated.timing(fill, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(press, { toValue: 0, useNativeDriver: true, damping: 14, stiffness: 240 }),
    ]).start();
  };

  const startHold = () => {
    if (busy) return;
    setHolding(true);
    tap('light');
    Animated.spring(press, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 240 }).start();
    midTick.current = setTimeout(() => tap('light'), HOLD_MS * 0.5);   // texture mid-travel
    Animated.timing(fill, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: true })
      .start(({ finished }) => {
        if (!finished) return;
        setHolding(false);
        tap('success');
        onConfirm && onConfirm();
        fill.setValue(0);
        Animated.spring(press, { toValue: 0, useNativeDriver: true, damping: 14, stiffness: 240 }).start();
      });
  };

  if (online) {
    // live session length, counting up every second (nowTick keeps this fresh)
    const elapsedMin = onlineSince ? Math.max(0, Math.floor((Date.now() - onlineSince) / 60000)) : 0;
    const eh = Math.floor(elapsedMin / 60), em = elapsedMin % 60;
    const timeStr = onlineSince ? (eh > 0 ? `${eh}h ${em}m online` : `${em}m online`) : 'Online';
    const money = earningsToday && earningsToday > 0 ? `$${earningsToday} today` : null;
    return (
      <TouchableOpacity onPress={onGoOffline} activeOpacity={0.9} style={styles.pill}>
        <View style={styles.liveDot} />
        <View style={{ flex: 1 }}>
          <Text style={styles.pillTitle} numberOfLines={1}>You're online{suburb ? ` · ${suburb}` : ''}</Text>
          <Text style={styles.pillSub} numberOfLines={1}>{[money, timeStr].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={styles.pillOff}>End shift</Text>
      </TouchableOpacity>
    );
  }

  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.42] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.42, 0.16, 0] });
  const orbScale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.95] });
  const fillScale = fill.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.orbBox}>
        {/* breathing halo */}
        <Animated.View style={[styles.halo, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} pointerEvents="none" />
        <Pressable onPressIn={startHold} onPressOut={cancelHold} disabled={busy}>
          <Animated.View style={[styles.orb, { transform: [{ scale: orbScale }] }]}>
            {/* charge fill — grows from the centre as you hold */}
            <Animated.View style={[styles.fill, { transform: [{ scale: fillScale }], opacity: fill }]} pointerEvents="none" />
            {/* soft top highlight for a lit, three-dimensional feel */}
            <View style={styles.gloss} pointerEvents="none" />
            <Text style={styles.go}>GO</Text>
          </Animated.View>
        </Pressable>
      </View>
      <Text style={styles.hint}>{holding ? 'Keep holding…' : 'Hold to go online'}</Text>
    </View>
  );
}

const ORB = 94;
const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  orbBox: { width: ORB + 40, height: ORB + 40, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: ORB, height: ORB, borderRadius: ORB / 2, backgroundColor: C.green },
  orb: {
    width: ORB, height: ORB, borderRadius: ORB / 2, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: C.green, shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  fill: { position: 'absolute', width: ORB, height: ORB, borderRadius: ORB / 2, backgroundColor: 'rgba(255,255,255,0.34)' },
  gloss: { position: 'absolute', top: 6, left: 14, right: 14, height: ORB * 0.42, borderRadius: ORB / 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  go: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: 1.5 },
  hint: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3, marginTop: 2, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  // online status pill
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(19,24,21,0.94)',
    borderRadius: 18, paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(30,199,120,0.35)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.green, shadowColor: C.green, shadowOpacity: 0.9, shadowRadius: 6 },
  pillTitle: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  pillSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  pillOff: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '700' },
});
