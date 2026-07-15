// Pulse.js — the app's heartbeat. Ambient, non-blocking home-screen section:
// aggregate stats up top (with a live pulsing dot) + a gently fading event feed.
// Calm cadence (research: intrusive/fast = annoying; ambient/steady = delightful).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { C, S, R, T, E } from './theme';
import { getPulseFeed, getPulseStats } from './pulseService';

// map an event kind -> how it reads in the feed. Varied, specific wording so
// the stream reads like real activity, not one repeated phrase.
function describe(e) {
  const suburb = e.suburb || 'Sydney';
  const label = e.label || 'Job';
  // a little deterministic variety per event id so lines don't all read alike
  const seed = (e.id || '').charCodeAt(0) || 0;
  const pick = (arr) => arr[seed % arr.length];

  switch (e.kind) {
    case 'checkin':
      return { dot: C.indigo, text: `${label} started on site · ${suburb}`, tone: C.ink };
    case 'checkout':
    case 'auto_approved':
      return { dot: C.green, text: pick([
        `${label} wrapped up · ${suburb}`,
        `${label} job completed · ${suburb}`,
        `${label} finished & paid · ${suburb}`,
      ]), tone: C.ink };
    case 'transition':
      return { dot: C.amber, text: pick([
        `${label} on the way · ${suburb}`,
        `${label} en route to ${suburb}`,
        `${label} heading to site · ${suburb}`,
        `${label} booked in · ${suburb}`,
      ]), tone: C.ink };
    case 'cancelled_by_operator':
      return { dot: C.mute2, text: `${label} spot reopened · ${suburb}`, tone: C.mute };
    default:
      return { dot: C.mute2, text: `${label} · ${suburb}`, tone: C.ink };
  }
}

function timeAgo(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function PulseDot() {
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(ring, { toValue: 1, duration: 2000, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [ring]);
  const scale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.8] });
  const opacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[st.ring, { transform: [{ scale }], opacity }]} />
      <View style={st.liveDot} />
    </View>
  );
}

// smoothly counts the hero number up when it changes — the dopamine tick.
function CountUp({ value, style }) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    const end = value;
    if (start === end) return;
    const t0 = Date.now();
    const dur = 700;
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);   // easeOutCubic
      setDisplay(Math.round(start + (end - start) * eased));
      if (p >= 1) { clearInterval(id); from.current = end; }
    }, 16);
    return () => clearInterval(id);
  }, [value]);
  return <Text style={style}>${display.toLocaleString()}</Text>;
}

function FeedRow({ e, index }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 450, delay: index * 60, useNativeDriver: true }).start();
  }, [anim, index]);
  const d = describe(e);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });
  return (
    <Animated.View style={[st.row, { opacity: anim, transform: [{ translateY }] }]}>
      <View style={[st.rowDot, { backgroundColor: d.dot }]} />
      <Text style={[st.rowText, { color: d.tone }]} numberOfLines={1}>{d.text}</Text>
      {e.amount != null && Number(e.amount) > 0 && (
        <Text style={st.rowAmt}>${Number(e.amount).toLocaleString()}</Text>
      )}
      <Text style={st.rowTime}>{timeAgo(e.at)}</Text>
    </Animated.View>
  );
}

export default function Pulse() {
  const [feed, setFeed] = useState([]);
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try {
      const [f, s] = await Promise.all([getPulseFeed(12), getPulseStats()]);
      setFeed(f);
      setStats(s);
    } catch (_) { /* stay quiet; heartbeat never nags */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000); // calm cadence
    return () => clearInterval(t);
  }, [load]);

  if (!stats) return null;

  return (
    <View style={st.wrap}>
      <View style={st.head}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <PulseDot />
          <Text style={st.title}>Live on SiteCall</Text>
        </View>
        <Text style={st.active}>{stats.active_now} active now</Text>
      </View>

      {/* HERO number — the dopamine. One big confident figure that ticks up. */}
      <CountUp value={Number(stats.paid_to_workers_today || 0)} style={st.heroNum} />
      <Text style={st.heroLbl}>paid to workers today · {stats.jobs_completed_today || 0} jobs done</Text>

      {/* a glimpse of live motion — just 3 recent events, clean single lines */}
      <View style={st.feed}>
        {feed.length === 0
          ? <Text style={st.empty}>Quiet right now — new activity appears here.</Text>
          : feed.slice(0, 3).map((e, i) => <FeedRow key={e.id} e={e} index={i} />)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: C.panel, borderRadius: R.xl, padding: 20, marginBottom: 28, ...E.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green, position: 'absolute' },
  ring: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.green, position: 'absolute' },
  title: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, color: C.ink },
  active: { fontSize: 12, fontWeight: '600', color: C.mute },
  heroNum: { fontSize: 38, fontWeight: '800', letterSpacing: -1.4, color: C.ink },
  heroLbl: { fontSize: 13, color: C.mute, marginTop: 2, marginBottom: 18 },
  feed: { gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.line2 },
  rowDot: { width: 7, height: 7, borderRadius: 4 },
  rowText: { flex: 1, fontSize: 13.5, fontWeight: '500' },
  rowAmt: { fontSize: 13, fontWeight: '800', color: C.green, letterSpacing: -0.2 },
  rowTime: { fontSize: 11, color: C.mute2, marginLeft: 6 },
  empty: { fontSize: 13, color: C.mute, paddingVertical: 14, textAlign: 'center' },
});
