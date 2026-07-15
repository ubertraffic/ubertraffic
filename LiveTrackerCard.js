// LiveTrackerCard.js — SiteCall's own "Live Activity" surface, in-app.
// Renders the unified Tracker payload (job_tracker_state) into a glanceable, animated card.
// This is the renderer; the brain is server-side. The SAME payload later feeds push + the
// native iOS Live Activity — build once, render everywhere.
//
// Design principles (researched): glanceability first (ONE headline — Uber shows ETA, we
// show the stage headline), progressive disclosure (compact by default, tap to expand),
// smooth value transitions (animate progress + ETA, never jump), stage-driven theming,
// and graceful handling of every lifecycle stage.

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing, Modal, ScrollView } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { C, R, shadowSm } from './theme';
import Icon from './Icon';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING = 52;
const STROKE = 5;
const RADIUS = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;
// expanded ring inner text box — kept well inside the 176px ring (13px stroke) so centre
// text never touches or overlaps the ring itself.
const BIG_CENTER = 176 - 13 * 2 - 24;

// The journey, in order — drives the expanded timeline. reconciling/pending fold into the
// nearest visible step so the arc always reads cleanly.
// Journey steps read from the viewer's side. A CLIENT is "finding a worker"; an OPERATOR viewing
// the same job is the worker — so their first step is "Job posted", not "finding you a worker".
const JOURNEY_CLIENT = [
  { key: 'finding',   label: 'Finding you a worker' },
  { key: 'committed', label: 'Booked' },
  { key: 'en_route',  label: 'On the way' },
  { key: 'on_site',   label: 'On site' },
  { key: 'approved',  label: 'Complete' },
];
const JOURNEY_OPERATOR = [
  { key: 'finding',   label: 'Job posted' },
  { key: 'committed', label: 'You accepted' },
  { key: 'en_route',  label: 'On the way' },
  { key: 'on_site',   label: 'On site' },
  { key: 'approved',  label: 'Paid' },
];
function journeyFor(perspective) {
  return perspective === 'operator' ? JOURNEY_OPERATOR : JOURNEY_CLIENT;
}
// map any live stage to its position on the 5-step journey
const STAGE_STEP = { finding: 0, committed: 1, en_route: 2, on_site: 3, reconciling: 3, pending_approval: 4, approved: 4 };

// stage → visual identity (colour + semantic icon). Keeps the card's mood tied to reality.
// Every active stage PULSES now — the card should feel alive at every moment, not just while
// searching. Colour is coded to the moment: amber (searching, tentative) → indigo (locked in /
// moving) → a vivid arrival green that stands out at ON SITE (the peak moment) → calm green (done).
const ONSITE = '#00C46A';   // vivid, alive green — arrival is the high point, so it pops
const STAGE_THEME = {
  finding:           { color: C.amber,  icon: 'search',   pulse: true },
  committed:         { color: C.indigo, icon: 'check',     pulse: true },
  en_route:          { color: C.indigo, icon: 'navigate',  pulse: true },
  on_site:           { color: ONSITE,   icon: 'pin',       pulse: true },
  reconciling:       { color: ONSITE,   icon: 'live',      pulse: true },
  pending_approval:  { color: C.amber,  icon: 'check',     pulse: true },
  approved:          { color: C.green,  icon: 'check',     pulse: false },
};

// per-worker status pill colours for the crew roster (calm, scannable)
function statusColor(s) {
  if (s === 'complete' || s === 'approved') return C.green;
  if (s === 'on_site') return C.green;
  if (s === 'en_route') return C.indigo;
  return C.mute;   // committed/accepted/other
}
function statusTint(s) {
  if (s === 'complete' || s === 'approved' || s === 'on_site') return 'rgba(14,122,82,0.10)';
  if (s === 'en_route') return 'rgba(70,54,232,0.10)';
  return 'rgba(120,120,140,0.10)';
}

// LIVE WORKING PHRASES — like a game's loading screen ("compiling shaders…"), these cycle while
// the job is active so it FEELS like the system is working behind the scenes, not stuck. Honest:
// every line reflects something the platform genuinely does at that stage.
const WORKING_LINES = {
  finding: [
    'Reaching workers near your site…',
    'Checking who\u2019s available right now…',
    'Matching your job to qualified crews…',
    'Notifying verified workers nearby…',
    'Widening the search radius…',
  ],
  committed: [
    'Worker locked in…',
    'Sharing site details with them…',
    'Getting them ready to head over…',
  ],
  en_route: [
    'Tracking their approach…',
    'Updating live distance…',
    'Watching for traffic…',
  ],
  on_site: [
    'Work underway on site…',
    'Tracking job progress…',
  ],
  pending_approval: [
    'Work complete \u2014 ready for you…',
    'Tallying the final hours…',
  ],
};

// Safe haptic tap — wrapped so a haptics failure can never affect the tracker (Law 11).
function trackerTap() {
  try { const H = require('expo-haptics'); H.impactAsync?.(H.ImpactFeedbackStyle?.Medium); } catch (_) {}
}

export default function LiveTrackerCard({ state, onAction, onPressCard }) {  const [expanded, setExpanded] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const etaAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const enterAnim = useRef(new Animated.Value(0)).current;
  const [shownEta, setShownEta] = useState(null);

  // when the search has stalled (no workers yet), calm the visual: mute the colour and stop the
  // energetic pulse, so the card doesn't look like it's actively finding someone when it isn't.
  const baseTheme = STAGE_THEME[state?.stage] || STAGE_THEME.finding;
  const theme = (state?.stalled || state?.no_coverage)
    ? { ...baseTheme, color: C.mute, pulse: false }
    : baseTheme;
  const progress = Math.max(0, Math.min(1, state?.progress || 0));
  // the ring now represents CONFIDENCE (earned certainty), not raw progress
  const confidence = Math.max(0, Math.min(1, state?.confidence != null ? state.confidence : progress));

  // enter animation (card slides/fades in the first time it appears)
  useEffect(() => {
    Animated.timing(enterAnim, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enterAnim]);

  // Haptic on the paid moment — the most satisfying beat in the app should FEEL like something.
  // Fires ONCE, exactly when the stage becomes 'approved' (paid), not on every render. Safe: wrapped
  // so a haptics failure can never affect the tracker (Constitution Law 11).
  const prevStageRef = useRef(state?.stage);
  useEffect(() => {
    const s = state?.stage;
    if (s === 'approved' && prevStageRef.current !== 'approved') {
      try {
        const H = require('expo-haptics');
        H.notificationAsync?.(H.NotificationFeedbackType?.Success);
      } catch (_) {}
    }
    prevStageRef.current = s;
  }, [state?.stage]);

  // smoothly animate the confidence ring toward the new value (never jump)
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: confidence, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [confidence, progressAnim]);

  // smoothly transition the ETA number (count toward the new value) — feels alive, not jumpy
  useEffect(() => {
    const target = state?.eta_min;
    if (target == null) { setShownEta(null); return; }
    const id = etaAnim.addListener(({ value }) => setShownEta(Math.round(value)));
    Animated.timing(etaAnim, { toValue: target, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    return () => etaAnim.removeListener(id);
  }, [state?.eta_min, etaAnim]);

  // gentle pulse for "live/moving" stages (en_route, finding, pending) — signals activity
  useEffect(() => {
    if (!theme.pulse) { pulseAnim.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [theme.pulse, pulseAnim, state?.stage]);

  if (!state || !state.exists) return null;

  const dashOffset = progressAnim.interpolate({ inputRange: [0, 1], outputRange: [CIRC, 0] });
  const pulseScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const pulseOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  const actor = state.actor;
  const cta = state.cta;
  const crew = state.crew || [];
  const crewSize = state.crew_size || 0;
  const isCrew = crewSize > 1;   // progressive disclosure: crew UI only when there's a real crew

  // detail line: prefer the live ETA (animated) when travelling, else the server detail
  const detailText = (state.stage === 'en_route' && shownEta != null)
    ? `~${shownEta} min away`
    : state.detail;

  return (
    <Animated.View style={[
      styles.wrap,
      { opacity: enterAnim, transform: [{ translateY: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] },
    ]}>
      <TouchableOpacity activeOpacity={0.92} onPress={() => { setExpanded(true); onPressCard && onPressCard(); }}>
        <View style={styles.row}>
          {/* progress ring with actor initial / stage icon in the centre */}
          <View style={styles.ringWrap}>
            {theme.pulse && (
              <Animated.View style={[styles.pulse, { backgroundColor: theme.color, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
            )}
            <Svg width={RING} height={RING}>
              <Circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke={C.line} strokeWidth={STROKE} fill="none" />
              <AnimatedCircle
                cx={RING / 2} cy={RING / 2} r={RADIUS}
                stroke={theme.color} strokeWidth={STROKE} fill="none"
                strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
              />
            </Svg>
            <View style={styles.ringCenter}>
              {actor?.initial
                ? <Text style={[styles.initial, { color: theme.color }]}>{actor.initial}</Text>
                : <Icon name={theme.icon} size={20} color={theme.color} />}
            </View>
          </View>

          {/* moment + confidence — the reassuring core (moment is the hero, not a status) */}
          <View style={styles.body}>
            <Text style={styles.headline} numberOfLines={2}>{state.moment || state.headline}</Text>
            <Text style={[styles.detail, { color: theme.color }]} numberOfLines={1}>
              {state.seen ? state.seen : (state.confidence_label ? state.confidence_label : detailText)}
              {!state.seen && state.stage === 'en_route' && shownEta != null ? ` · ~${shownEta} min` : ''}
            </Text>
          </View>

          {/* a subtle chevron so it reads as tappable-to-expand */}
          <Icon name="chevronRight" size={18} color={C.mute} />
        </View>

        {/* crew strip — only when there's a real crew (progressive disclosure) */}
        {isCrew && (
          <View style={styles.crewStrip}>
            <View style={styles.crewAvatars}>
              {crew.slice(0, 4).map((m, i) => (
                <View key={m.assignment_id || i} style={[styles.crewAvatar, { backgroundColor: theme.color, marginLeft: i === 0 ? 0 : -8, zIndex: 4 - i }]}>
                  <Text style={styles.crewAvatarT}>{m.initial}</Text>
                </View>
              ))}
              {crewSize > 4 && (
                <View style={[styles.crewAvatar, styles.crewMore, { marginLeft: -8 }]}><Text style={styles.crewMoreT}>+{crewSize - 4}</Text></View>
              )}
            </View>
            <Text style={styles.crewSummary} numberOfLines={1}>{state.crew_summary || `Crew of ${crewSize}`}</Text>
            <Text style={[styles.crewTapHint, { color: theme.color }]}>View crew ›</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* ACTIONS — full-width, below the status. Primary advances the job (start/arrive/complete);
          secondary (message client) sits beneath it. Outside the tappable area so tapping a button
          performs its action rather than expanding the card. */}
      {(cta || state.cta2) && (
        <View style={styles.actions}>
          {cta && (
            <TouchableOpacity style={[styles.ctaPrimary, { backgroundColor: theme.color }]} onPress={() => { trackerTap(); onAction && onAction(cta.action); }} activeOpacity={0.85}>
              <Text style={styles.ctaPrimaryT}>{cta.label}</Text>
            </TouchableOpacity>
          )}
          {state.cta2 && (
            <TouchableOpacity style={styles.cta2} onPress={() => { trackerTap(); onAction && onAction(state.cta2.action); }} activeOpacity={0.7}>
              <Text style={[styles.cta2T, { color: theme.color }]}>{state.cta2.label}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Full-screen live tracking — the confidence experience. Same payload, full depth. */}
      <TrackerExpanded
        visible={expanded}
        state={state}
        theme={theme}
        confidence={confidence}
        shownEta={shownEta}
        onClose={() => setExpanded(false)}
        onAction={onAction}
      />
    </Animated.View>
  );
}

// ── TrackerExpanded — the full-screen CONFIDENCE experience ─────────────────────
// Hierarchy (per brief): the moment · who's responsible · confidence · next step —
// all visible without scrolling. The ring is CONFIDENCE (earned certainty), the worker
// block carries real trust signals (rating, jobs, verified credential WHEN real), and the
// next-step line kills the silence. Motion is reassuring: soft breathing, gentle fills.
function TrackerExpanded({ visible, state, theme, confidence, shownEta, onClose, onAction }) {
  const ringAnim = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const [tick, setTick] = useState(0);

  // cycle the "working" lines while the job is live — the game-loading aliveness. Rotates every
  // 2.4s through stage-appropriate phrases so the screen always feels like it's DOING something.
  // BUT: once the server reports the search has STALLED (no workers yet), stop cycling — pretending
  // to still be "reaching workers…" would be dishonest. Show the server's honest static copy instead.
  const workLines = (state?.stalled || state?.no_coverage) ? null : (WORKING_LINES[state?.stage] || null);
  useEffect(() => {
    if (!visible || !workLines || workLines.length <= 1) return;
    const id = setInterval(() => setTick((t) => t + 1), 2400);
    return () => clearInterval(id);
  }, [visible, workLines, state?.stage]);

  useEffect(() => {
    if (!visible) return;
    Animated.timing(ringAnim, { toValue: confidence, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [visible, confidence, ringAnim]);

  // soft breathing on the confidence ring while the job is live — reassuring presence,
  // never a flash or bounce (per brief: think Apple, not gaming).
  useEffect(() => {
    if (!visible) { breathe.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [visible, breathe, state?.stage]);

  if (!state || !state.exists) return null;

  const exCrew = state.crew || [];
  const exIsCrew = (state.crew_size || 0) > 1;

  const BIG = 176, BSTROKE = 13, BR = (BIG - BSTROKE) / 2, BCIRC = 2 * Math.PI * BR;
  const bigOffset = ringAnim.interpolate({ inputRange: [0, 1], outputRange: [BCIRC, 0] });
  const haloScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const haloOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.10, 0.02] });
  const actor = state.actor;
  const cta = state.cta;
  const curStep = STAGE_STEP[state.stage] ?? 0;
  const journey = journeyFor(state.perspective);
  const confPct = Math.round((confidence || 0) * 100);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.exWrap}>
        <View style={styles.exHeader}>
          <TouchableOpacity onPress={onClose} style={styles.exClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.exCloseT}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.exHeaderT}>Live job</Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* the CONFIDENCE ring — hero. Fills on verified milestones; label is a human phrase. */}
          <View style={styles.exRingWrap}>
            <Animated.View style={[styles.exHalo, { backgroundColor: theme.color, transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
            <Svg width={BIG} height={BIG}>
              <Circle cx={BIG / 2} cy={BIG / 2} r={BR} stroke={C.line} strokeWidth={BSTROKE} fill="none" />
              <AnimatedCircle
                cx={BIG / 2} cy={BIG / 2} r={BR}
                stroke={theme.color} strokeWidth={BSTROKE} fill="none"
                strokeLinecap="round" strokeDasharray={BCIRC} strokeDashoffset={bigOffset}
                transform={`rotate(-90 ${BIG / 2} ${BIG / 2})`}
              />
            </Svg>
            <View style={styles.exRingCenter}>
              <Text style={[styles.exConfLabel, { color: theme.color }]} numberOfLines={2}>{state.confidence_label || 'On track'}</Text>
              {state.stage === 'en_route' && shownEta != null ? (
                <Text style={styles.exConfSub}>~{shownEta} min away</Text>
              ) : state.stage === 'finding' ? (
                <View style={styles.exWorkingDots}>
                  <Animated.View style={[styles.exDot, { backgroundColor: theme.color, opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]} />
                  <Animated.View style={[styles.exDot, { backgroundColor: theme.color, opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }]} />
                  <Animated.View style={[styles.exDot, { backgroundColor: theme.color, opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]} />
                </View>
              ) : (
                <Text style={styles.exConfSub}>{confPct}%</Text>
              )}
            </View>
          </View>

          {/* the moment — reassuring, specific, the hero line */}
          <Text style={styles.exHeadline}>{state.moment || state.headline}</Text>

          {/* LIVE working ticker — cycles like a loading screen so it feels alive, not stuck */}
          {workLines && workLines.length > 0 ? (
            <View style={styles.exTicker}>
              <View style={[styles.exTickerPulse, { backgroundColor: theme.color }]} />
              <Text style={[styles.exTickerT, { color: theme.color }]} numberOfLines={1}>
                {workLines[tick % workLines.length]}
              </Text>
            </View>
          ) : null}

          {/* removed the "Next: you approve…" next-step copy — it read as clutter and didn't
              add life. The stage headline + ticker already say what's happening. */}

          {/* the loop-closing reassurance (operator perspective): the client can see this */}
          {state.seen ? (
            <View style={[styles.exSeen, { borderColor: theme.color }]}>
              <Icon name="check" size={14} color={theme.color} />
              <Text style={[styles.exSeenT, { color: theme.color }]}>{state.seen}</Text>
            </View>
          ) : null}

          {/* who's responsible — single worker: the trust block. Crew: the full roster. */}
          {exIsCrew ? (
            <View style={styles.exCrewBlock}>
              <View style={styles.exCrewHead}>
                <Text style={styles.exCrewTitle}>Your crew</Text>
                <Text style={styles.exCrewCount}>{state.crew_summary || `${state.crew_size} workers`}</Text>
              </View>
              {exCrew.map((m, i) => (
                <TouchableOpacity
                  key={m.assignment_id || i}
                  style={styles.exCrewRow}
                  activeOpacity={m.operator_id ? 0.7 : 1}
                  onPress={() => { if (m.operator_id && onAction) { onAction('open_profile', m.operator_id); onClose(); } }}
                  disabled={!m.operator_id}
                >
                  <View style={[styles.exCrewAvatar, { backgroundColor: theme.color }]}><Text style={styles.exCrewAvatarT}>{m.initial}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.exCrewName}>{m.name}{m.trade ? <Text style={styles.exCrewTrade}>  ·  {m.trade}</Text> : null}</Text>
                    <Text style={styles.exCrewMeta}>
                      {m.rating != null ? `★ ${Number(m.rating).toFixed(1)}` : 'New'}
                      {m.verified_cred ? `  ·  ✓ ${m.verified_cred}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.exCrewPill, { backgroundColor: statusTint(m.status) }]}>
                    <Text style={[styles.exCrewPillT, { color: statusColor(m.status) }]}>{m.status_label}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : actor?.name ? (
            <TouchableOpacity
              style={styles.exWorker}
              activeOpacity={actor.operator_id ? 0.7 : 1}
              onPress={() => { if (actor.operator_id && onAction) { onAction('open_profile', actor.operator_id); onClose(); } }}
              disabled={!actor.operator_id}
            >
              <View style={[styles.exAvatar, { backgroundColor: theme.color }]}>
                <Text style={styles.exAvatarT}>{actor.initial}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.exWorkerName}>{actor.name}</Text>
                <Text style={styles.exWorkerMeta}>
                  {actor.rating != null ? `★ ${Number(actor.rating).toFixed(1)}` : ''}
                  {actor.jobs_done != null ? `${actor.rating != null ? '  ·  ' : ''}${actor.jobs_done} jobs` : ''}
                  {actor.vehicle ? `  ·  ${actor.vehicle}` : ''}
                </Text>
              </View>
              {/* verified badge ONLY when it's real — the honesty principle, visible */}
              {actor.verified_cred ? (
                <View style={[styles.exVerified, { borderColor: theme.color }]}>
                  <Icon name="verified" size={13} color={theme.color} />
                  <Text style={[styles.exVerifiedT, { color: theme.color }]} numberOfLines={1}>{actor.verified_cred}</Text>
                </View>
              ) : (actor.operator_id ? <Text style={styles.exWorkerChevron}>›</Text> : null)}
            </TouchableOpacity>
          ) : null}

          {/* the journey — where we are, what's verified */}
          <View style={styles.exTimeline}>
            {journey.map((step, i) => {
              const done = i < curStep;
              const active = i === curStep;
              const color = done || active ? theme.color : C.line;
              return (
                <View key={step.key} style={styles.exStep}>
                  <View style={styles.exStepLeft}>
                    <View style={[styles.exDot, { backgroundColor: done || active ? color : C.panel, borderColor: color }]}>
                      {done && <Text style={styles.exDotCheck}>✓</Text>}
                      {active && <View style={[styles.exDotLive, { backgroundColor: C.panel }]} />}
                    </View>
                    {i < journey.length - 1 && <View style={[styles.exStepLine, { backgroundColor: done ? theme.color : C.line }]} />}
                  </View>
                  <Text style={[styles.exStepLabel, (done || active) && { color: C.ink, fontWeight: active ? '800' : '600' }]}>{step.label}</Text>
                </View>
              );
            })}
          </View>

          {/* actions */}
          <View style={styles.exActions}>
            {cta && (
              <TouchableOpacity style={[styles.exPrimary, { backgroundColor: theme.color }]} onPress={() => { onAction && onAction(cta.action); onClose(); }} activeOpacity={0.9}>
                <Text style={styles.exPrimaryT}>{cta.label}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.exHelp} onPress={() => { onAction && onAction('open_help'); }} activeOpacity={0.8}>
              <Text style={styles.exHelpT}>Need help with this job?</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.panel, borderRadius: R.xl, padding: 14, marginHorizontal: 16, marginTop: 12, ...shadowSm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  pulse: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2 },
  ringCenter: { position: 'absolute', width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 19, fontWeight: '800' },
  body: { flex: 1, minWidth: 0 },
  headline: { fontSize: 16, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  detail: { fontSize: 13.5, fontWeight: '700', marginTop: 2 },
  cta: { borderWidth: 1.5, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 9 },
  ctaT: { fontSize: 13, fontWeight: '800' },
  actions: { marginTop: 12, gap: 2 },
  ctaPrimary: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  ctaPrimaryT: { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  cta2: { paddingVertical: 10, alignItems: 'center' },
  cta2T: { fontSize: 13, fontWeight: '700' },

  // ── expanded full-screen ──
  exWrap: { flex: 1, backgroundColor: C.canvas, paddingTop: 56 },
  exHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  exClose: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  exCloseT: { fontSize: 20, color: C.mute, fontWeight: '600' },
  exHeaderT: { fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: 0.2 },
  exRingWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 24, marginBottom: 8, height: 176 },
  exHalo: { position: 'absolute', width: 176, height: 176, borderRadius: 88 },
  exRingCenter: { position: 'absolute', width: BIG_CENTER, height: BIG_CENTER, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  exConfLabel: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center', lineHeight: 19 },
  exConfSub: { fontSize: 12.5, color: C.mute, fontWeight: '700', marginTop: 3 },
  exWorkingDots: { flexDirection: 'row', gap: 4, marginTop: 7 },
  exDot: { width: 5, height: 5, borderRadius: 2.5 },
  exTicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12, paddingHorizontal: 24 },
  exTickerPulse: { width: 6, height: 6, borderRadius: 3 },
  exTickerT: { fontSize: 13.5, fontWeight: '700', letterSpacing: -0.1 },
  exHeadline: { fontSize: 21, fontWeight: '900', color: C.ink, textAlign: 'center', marginTop: 22, letterSpacing: -0.4, paddingHorizontal: 24 },
  exNext: { fontSize: 14, color: C.mute, textAlign: 'center', marginTop: 8, fontWeight: '600', paddingHorizontal: 24 },
  exSeen: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center', marginTop: 16, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, maxWidth: '86%' },
  exSeenT: { fontSize: 13, fontWeight: '700' },
  exWorker: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: C.panel, marginHorizontal: 20, marginTop: 24, padding: 14, borderRadius: R.xl, ...shadowSm },
  exAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  exAvatarT: { color: '#fff', fontSize: 20, fontWeight: '800' },
  exWorkerName: { fontSize: 16, fontWeight: '800', color: C.ink },
  exWorkerMeta: { fontSize: 13, color: C.mute, fontWeight: '600', marginTop: 2 },
  exWorkerChevron: { fontSize: 22, color: C.mute, fontWeight: '700', marginLeft: 4 },
  // collapsed crew strip
  crewStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  crewAvatars: { flexDirection: 'row', alignItems: 'center' },
  crewAvatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.panel },
  crewAvatarT: { color: '#fff', fontSize: 11, fontWeight: '800' },
  crewMore: { backgroundColor: C.mute },
  crewMoreT: { color: '#fff', fontSize: 10, fontWeight: '800' },
  crewSummary: { flex: 1, fontSize: 13, fontWeight: '700', color: C.ink },
  crewTapHint: { fontSize: 12.5, fontWeight: '800' },
  // expanded crew roster
  exCrewBlock: { marginHorizontal: 20, marginTop: 24, backgroundColor: C.panel, borderRadius: R.xl, padding: 14, ...shadowSm },
  exCrewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  exCrewTitle: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.6, textTransform: 'uppercase' },
  exCrewCount: { fontSize: 12.5, fontWeight: '700', color: C.ink },
  exCrewRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  exCrewAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  exCrewAvatarT: { color: '#fff', fontSize: 15, fontWeight: '800' },
  exCrewName: { fontSize: 15, fontWeight: '800', color: C.ink },
  exCrewTrade: { fontSize: 13, fontWeight: '600', color: C.mute },
  exCrewMeta: { fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 2 },
  exCrewPill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  exCrewPillT: { fontSize: 12, fontWeight: '800' },
  exVerified: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 130 },
  exVerifiedT: { fontSize: 11.5, fontWeight: '800' },
  exTimeline: { marginHorizontal: 24, marginTop: 28 },
  exStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  exStepLeft: { alignItems: 'center', width: 22 },
  exDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  exDotCheck: { color: '#fff', fontSize: 12, fontWeight: '900' },
  exDotLive: { width: 8, height: 8, borderRadius: 4 },
  exStepLine: { width: 2, height: 26, marginVertical: 2 },
  exStepLabel: { fontSize: 15, color: C.mute, fontWeight: '600', paddingTop: 1 },
  exActions: { marginHorizontal: 20, marginTop: 32, gap: 12 },
  exPrimary: { borderRadius: R.xl, paddingVertical: 16, alignItems: 'center' },
  exPrimaryT: { color: '#fff', fontSize: 16, fontWeight: '800' },
  exHelp: { paddingVertical: 14, alignItems: 'center' },
  exHelpT: { fontSize: 14, color: C.mute, fontWeight: '700' },
});
