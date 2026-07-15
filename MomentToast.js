// MomentToast.js — the "beautiful and relieving" moment-cards.
// A toast rises from the bottom at each real lifecycle beat (accepted / on the
// way / on site / complete), lingers ~4s, and eases away. Warm, human voice.
// Both ends tailored. Driven by job_events (real jobs only) — a beat is only
// ever shown when it truly happened in the DB.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Animated, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { supabase } from './supabaseClient';
import { getRecentBeats } from './beatsService';
import { C, MONO, R, shadow } from './theme';

/* ---- warm, human copy per beat, tailored by side and multi-spot aware ---- */
function beatCopy(b) {
  const who = b.other_name || (b.role === 'client' ? 'An operator' : 'The client');
  const suburb = b.suburb ? ` · ${b.suburb}` : '';
  const needed = b.needed || 1;
  const done = b.done || 0;
  const multi = needed > 1;
  const ofN = multi ? ` (${Math.min(done || b.spot_index || 1, needed)} of ${needed})` : '';
  const allDone = done >= needed;

  if (b.role === 'client') {
    switch (b.to_status) {
      // 'paid' fires from whatever confirms settlement. TODAY that's approve_request
      // (settlement is instant/simulated), so "Payment cleared" is truthful now.
      // WHEN LIVE: move the 'paid' job_event out of approve_request and into the
      // Stripe payout-confirmed webhook, so this only fires once funds actually move.
      case 'paid':
        return { tone: C.green, big: true,
                 title: b.amount != null ? `Payment cleared · $${Math.round(b.amount).toLocaleString()}` : `Payment cleared`,
                 sub: `Job's done and settled${suburb}. Nice work.` };
      case 'committed':
        return { tone: C.green, title: multi ? `A spot's been secured${ofN}` : `${who}'s committed to your job`,
                 sub: multi ? `${who} is on board — getting ready to leave${suburb}.` : `They're getting ready to leave${suburb}. You'll see when they're on the way.` };
      case 'filled':
        return { tone: C.green, title: `You're fully covered`, sub: `All ${multi ? needed + ' spots' : 'set'} on your job are taken${suburb}. Help is locked in.` };
      case 'accepted':
        return { tone: C.green, title: multi ? `A spot's been taken${ofN}` : `${who} accepted your job`,
                 sub: multi ? `${who} is on board${suburb}.` : `They're locked in${suburb}. Sit tight — you're covered.` };
      case 'en_route':
        return { tone: C.indigo, title: multi ? `An operator's on the way${ofN}` : `${who}'s on the way`,
                 sub: `${who} is heading to site${suburb}.` };
      case 'on_site':
        return { tone: C.indigo, title: multi ? `An operator's arrived${ofN}` : `${who} has arrived on site`,
                 sub: `${who} is on site and getting started${suburb}.` };
      case 'complete':
        // only celebrate "job complete" when EVERY spot is done
        if (allDone) return { tone: C.green, title: `Job complete`, sub: `All work is finished${suburb}. Ready for you to approve & pay.` };
        return { tone: C.mute, title: `A spot's wrapped up${ofN}`, sub: `${who} finished their part${suburb}. ${needed - done} still going.` };
      default: return null;
    }
  }
  // operator side — about THIS operator's own spot
  switch (b.to_status) {
    case 'paid':
      return { tone: C.green, big: true,
               title: b.amount != null ? `You've been paid · $${Math.round(b.amount).toLocaleString()}` : `Payment cleared`,
               sub: `Funds are on the way for your job${suburb}.` };
    case 'committed':
      return { tone: C.green, title: `You've secured it`, sub: `Your spot's confirmed${suburb}. Start your journey when you're ready.` };
    case 'filled':
      return { tone: C.green, title: `Crew's complete`, sub: `All ${needed} spots on this job are filled${suburb}.` };
    case 'accepted':
      return { tone: C.green, title: `You're locked in`, sub: multi ? `Your spot's confirmed${suburb}. Head over when ready.` : `Spot confirmed${suburb}. Head over when you're ready.` };
    case 'en_route':
      return { tone: C.indigo, title: `You're on the way`, sub: `Marked en route${suburb}.` };
    case 'on_site':
      return { tone: C.indigo, title: `Checked in on site`, sub: `Arrival confirmed${suburb}. Nice one.` };
    case 'complete':
      return { tone: C.green, title: `Your job's done`, sub: `Completed${suburb}. Payment's on its way once approved.` };
    default: return null;
  }
}

function Toast({ beat, onDone }) {
  const y = useRef(new Animated.Value(120)).current;
  const op = useRef(new Animated.Value(0)).current;
  const copy = beatCopy(beat);

  useEffect(() => {
    // rise in
    Animated.parallel([
      Animated.spring(y, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }),
      Animated.timing(op, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
    // ease away after ~6s (long enough to register + feel relieving)
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(y, { toValue: 120, duration: 320, useNativeDriver: true }),
        Animated.timing(op, { toValue: 0, duration: 320, useNativeDriver: true }),
      ]).start(() => onDone && onDone());
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(y, { toValue: 120, duration: 220, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onDone && onDone());
  };

  if (!copy) return null;
  return (
    <Animated.View style={[st.wrap, { opacity: op, transform: [{ translateY: y }] }]}>
      <TouchableOpacity activeOpacity={0.92} onPress={dismiss} style={[st.card, shadow, copy.big && st.cardBig]}>
        {copy.big
          ? <View style={st.payBadge}><Text style={st.payBadgeT}>✓</Text></View>
          : <View style={[st.accent, { backgroundColor: copy.tone }]} />}
        <View style={{ flex: 1 }}>
          <Text style={[st.title, copy.big && st.titleBig]} numberOfLines={1}>{copy.title}</Text>
          <Text style={[st.sub, copy.big && st.subBig]} numberOfLines={2}>{copy.sub}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * MomentToasts — mount once near the app root. Watches job_events (realtime) and
 * raises a rising toast for each NEW lifecycle beat that belongs to this user.
 */
export default function MomentToasts() {
  const [queue, setQueue] = useState([]);        // beats waiting / showing
  const seen = useRef(new Set());                // event_ids already shown
  const primed = useRef(false);                  // skip the first load (history, not news)

  const check = useCallback(async () => {
    try {
      const beats = await getRecentBeats();
      // first pass: remember what already exists, don't toast history
      if (!primed.current) {
        beats.forEach((b) => seen.current.add(b.event_id));
        primed.current = true;
        return;
      }
      // newest last so they surface in order
      const fresh = beats.filter((b) => !seen.current.has(b.event_id)).reverse();
      if (fresh.length) {
        fresh.forEach((b) => seen.current.add(b.event_id));
        setQueue((q) => [...q, ...fresh]);
      }
    } catch (_) { /* stay silent — never nag */ }
  }, []);

  useEffect(() => {
    check(); // prime
    const channel = supabase
      .channel('beats-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'job_events' }, () => {
        check();            // fire immediately — the row is already committed when realtime delivers
        setTimeout(check, 400); // one quick follow-up in case joined rows lagged a beat
      })
      .subscribe();
    // safety poll in case a realtime event is missed
    const poll = setInterval(check, 8000);
    return () => { supabase.removeChannel(channel); clearInterval(poll); };
  }, [check]);

  // show one at a time
  const current = queue[0];
  const handleDone = useCallback(() => setQueue((q) => q.slice(1)), []);
  if (!current) return null;

  return (
    <View pointerEvents="box-none" style={st.host}>
      <Toast key={current.event_id} beat={current} onDone={handleDone} />
    </View>
  );
}

const st = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end', paddingBottom: Platform.OS === 'ios' ? 96 : 80 },
  wrap: { paddingHorizontal: 14 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderRadius: R.lg, padding: 15, borderWidth: 1.5, borderColor: '#D2D2CE',
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  cardBig: { backgroundColor: C.green, borderColor: '#006E49' },
  payBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  payBadgeT: { color: '#fff', fontSize: 17, fontWeight: '900', lineHeight: 21 },
  titleBig: { color: '#fff', fontSize: 15.5 },
  subBig: { color: 'rgba(255,255,255,0.92)' },
  accent: { width: 4, alignSelf: 'stretch', borderRadius: 4, marginRight: 12 },
  title: { fontFamily: MONO, fontSize: 13.5, fontWeight: '800', color: C.ink, letterSpacing: 0.2 },
  sub: { fontSize: 12.5, color: C.mute, marginTop: 3, lineHeight: 17 },
});
