// SearchingScreen.js
// The client's "finding operators" moment — designed calm, per UX research on
// waiting/anxiety: real progress (not a fake loop), one soft breathing motion,
// muted palette, generous whitespace, and a gentle (not explosive) payoff.
//
// Renders as a FULL SCREEN state (own View, flex:1) — shown via an early return
// in the parent, never as an overlay. Same props as before, so wiring is unchanged.
//
// Props: requestId, summary, onViewJob, onClose
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, ScrollView } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { getRequestLiveStatus } from './requestsService';
import { useRealtime } from './useRealtime';
import { C, MONO, S, R, T, shadow } from './theme';
import Icon from './Icon';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING = 168;            // ring diameter
const STROKE = 6;
const RADIUS = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

export default function SearchingScreen({ requestId, summary, onViewJob, onClose }) {
  const [status, setStatus] = useState({ notified: 0, needed: 0, filled: 0, items: [] });
  const [elapsed, setElapsed] = useState(0);   // seconds since search began — drives the "taking a while" state
  const breathe = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;   // 0..1 real fill fraction
  const checkIn = useRef(new Animated.Value(0)).current;    // payoff ease-in

  const refresh = useCallback(async () => {
    try { setStatus(await getRequestLiveStatus(requestId)); } catch (e) {}
  }, [requestId]);
  useEffect(() => { refresh(); }, [refresh]);
  useRealtime(['dispatches', 'assignments'], refresh);

  // tick elapsed seconds so we can honestly shift the messaging when a search is taking a while
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const needed = status.needed || 0;
  const filled = status.filled || 0;
  const notified = status.notified || 0;
  const isDone = needed > 0 && filled >= needed;
  const frac = needed > 0 ? Math.min(1, filled / needed) : 0;

  // "Taking a while" — an HONEST state so the client is never left staring at an endless spinner.
  // Two flavours: (a) nobody qualified was even reachable (notified 0 after a bit) → likely no
  // coverage; (b) workers were alerted but haven't accepted yet → still possible, just slow.
  const STALL_AFTER = 45;   // seconds
  const stalled = !isDone && elapsed >= STALL_AFTER && filled === 0;
  const noCoverage = stalled && notified === 0;   // nobody qualified nearby was even reached

  // one soft breathing motion (calm, not busy) — runs only while actively waiting, not once stalled
  useEffect(() => {
    if (isDone || stalled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isDone, stalled, breathe]);

  // animate the ring to the REAL fraction whenever it changes (smooth, honest progress)
  useEffect(() => {
    Animated.timing(progress, {
      toValue: frac, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [frac, progress]);

  // gentle payoff ease-in
  useEffect(() => {
    if (isDone) {
      Animated.timing(checkIn, { toValue: 1, duration: 520, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
    }
  }, [isDone, checkIn]);

  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const breatheOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.10, 0.03] });
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [CIRC, 0] });
  const checkScale = checkIn.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.wrap} bounces={false}>
        {/* tiny reassurance the tap registered */}
        <View style={styles.sentPill}>
          <Icon name="check" size={13} color={C.green} strokeWidth={3} />
          <Text style={styles.sentText}>Request sent</Text>
        </View>

        {/* hero: breathing halo + real progress ring */}
        <View style={styles.hero}>
          <Animated.View style={[styles.halo, { transform: [{ scale: breatheScale }], opacity: breatheOpacity }]} />
          <Svg width={RING} height={RING}>
            {/* track */}
            <Circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke={C.line} strokeWidth={STROKE} fill="none" />
            {/* real progress */}
            <AnimatedCircle
              cx={RING / 2} cy={RING / 2} r={RADIUS}
              stroke={isDone ? C.green : C.indigo} strokeWidth={STROKE} fill="none"
              strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          </Svg>

          {/* center content */}
          <View style={styles.heroCenter}>
            {isDone ? (
              <Animated.View style={{ transform: [{ scale: checkScale }], opacity: checkIn }}>
                <View style={styles.checkDot}><Icon name="check" size={30} color="#fff" strokeWidth={3} /></View>
              </Animated.View>
            ) : (
              <>
                <Text style={styles.count}>{filled}<Text style={styles.countOf}> / {needed || '·'}</Text></Text>
                <Text style={styles.countLabel}>spots filled</Text>
              </>
            )}
          </View>
        </View>

        {/* headline + sub */}
        <Text style={styles.title}>
          {isDone ? "You're all set"
            : noCoverage ? 'No workers available yet'
            : stalled ? 'Still looking…'
            : 'Finding your crew'}
        </Text>
        <Text style={styles.sub}>
          {isDone ? 'Every spot is filled and locked in.'
            : noCoverage ? "We couldn't reach an available worker for this right now. Your request stays live — or adjust it and try again."
            : stalled ? "Workers have been alerted but no one's accepted yet. This can happen at busy times — your request stays live."
            : (summary || 'Alerting verified workers nearby…')}
        </Text>

        {/* tidy per-item list (calm, readable) */}
        {status.items.length > 0 && (
          <View style={styles.card}>
            {status.items.map((it, i) => {
              const done = it.filled >= it.qty;
              return (
                <View key={i} style={[styles.row, i < status.items.length - 1 && styles.rowDivider]}>
                  <Text style={styles.rowName}>{it.type}</Text>
                  <View style={styles.rowRight}>
                    {done && <Icon name="check" size={13} color={C.green} strokeWidth={3} />}
                    <Text style={[styles.rowCount, done && { color: C.green }]}>{it.filled}/{it.qty}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* footer */}
      <View style={styles.footer}>
        {isDone ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={onViewJob} activeOpacity={0.9}>
            <Text style={styles.primaryText}>View job details</Text>
          </TouchableOpacity>
        ) : stalled ? (
          <>
            {/* honest dead-end handling: the search hasn't found anyone, so give real choices
                rather than an endless breathing ring. The request stays live either way. */}
            <TouchableOpacity style={styles.primaryBtn} onPress={onViewJob} activeOpacity={0.9}>
              <Text style={styles.primaryText}>View job & options</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.ghostText}>Keep searching in background</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>{noCoverage ? 'Tip: a higher rate or wider timing can reach more workers.' : "We'll alert you the moment someone accepts."}</Text>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.ghostText}>Keep searching in background</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Your request stays live. We'll keep alerting workers.</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60, paddingBottom: 24 },

  sentPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.greenSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginBottom: 40 },
  sentText: { fontSize: 11, fontWeight: '700', color: C.green, fontFamily: MONO, letterSpacing: 0.5, textTransform: 'uppercase' },

  hero: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  halo: { position: 'absolute', width: RING + 40, height: RING + 40, borderRadius: (RING + 40) / 2, backgroundColor: C.indigo },
  heroCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 44, fontWeight: '800', color: C.ink, fontFamily: MONO, letterSpacing: -1 },
  countOf: { fontSize: 26, color: C.mute2, fontWeight: '600' },
  countLabel: { fontSize: 11, color: C.mute, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 2 },
  checkDot: { width: 62, height: 62, borderRadius: 31, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', ...shadow },

  title: { fontSize: 25, fontWeight: '800', letterSpacing: -0.5, color: C.ink, textAlign: 'center' },
  sub: { fontSize: 14.5, color: C.mute, textAlign: 'center', marginTop: 8, lineHeight: 21, maxWidth: 300 },

  card: { alignSelf: 'stretch', backgroundColor: C.panel, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, paddingHorizontal: 16, paddingVertical: 4, marginTop: 28, ...shadow },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: C.line2 },
  rowName: { fontSize: 14.5, fontWeight: '600', color: C.ink },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowCount: { fontSize: 12.5, fontWeight: '700', color: C.mute, fontFamily: MONO },

  footer: { paddingHorizontal: 24, paddingBottom: 40, paddingTop: 8 },
  primaryBtn: { backgroundColor: C.indigo, borderRadius: R.lg, padding: 17, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  ghostBtn: { borderWidth: 1, borderColor: C.line, borderRadius: R.lg, padding: 15, alignItems: 'center', backgroundColor: C.panel },
  ghostText: { color: C.ink, fontWeight: '600', fontSize: 14 },
  hint: { fontSize: 11.5, color: C.mute2, textAlign: 'center', marginTop: 12, lineHeight: 16, fontFamily: MONO },
});
