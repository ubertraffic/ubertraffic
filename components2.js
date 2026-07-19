// components2.js — presentational component cluster extracted from App.js (paste-size fix).
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Animated, Easing, Modal, StyleSheet } from 'react-native';
import { C, R, S, E, M, T } from './theme';
import { S_ } from './styles';
import Icon, { iconForType } from './Icon';
import { repLine, requestHasStall, autoReleaseIn, friendly, suburbOf, EmptyState } from './components';
import { searchAddress } from './geocodeService';

export function RateCard({ it, onChange }) {
  const [floor, lo, hi] = RATES[it.type] || [45, 55, 85];
  const min = Math.round(floor * 0.85), max = Math.round(hi * 1.25);
  const [w, setW] = useState(0);
  const pct = (v) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const valFromX = (x) => {
    if (!w) return it.rate;
    const frac = Math.max(0, Math.min(1, x / w));
    return Math.round(min + frac * (max - min));
  };
  const pan = React.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => onChange(valFromX(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => onChange(valFromX(e.nativeEvent.locationX)),
  })).current;

  return (
    <View style={[S_.card, { marginBottom: 12 }]}>
      <View style={S_.rowBetween}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name={iconForType(it.type, it.kind)} size={16} color={C.ink} /><Text style={T.bodyStrong}>{it.type}</Text></View>
        <Text style={T.money}>${it.rate}<Text style={{ fontSize: 12, color: C.mute }}>/hr</Text></Text>
      </View>

      {/* draggable track */}
      <View
        style={S_.slider}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={S_.sliderTrack} />
        <View style={[S_.sliderRange, { left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }]} />
        <View style={[S_.sliderFloorMark, { left: `${pct(floor)}%` }]} />
        <View style={[S_.sliderKnob, { left: `${pct(it.rate)}%` }]} />
      </View>
      <View style={[S_.rowBetween, { marginTop: 8 }]}>
        <Text style={[T.label, { fontSize: 9 }]}>Floor ${floor}</Text>
        <Text style={[T.label, { fontSize: 9, color: C.green }]}>Going ${lo}–{hi}</Text>
      </View>

      <View style={S_.rateBtns}>
        <TouchableOpacity style={S_.rateBtn} onPress={() => onChange(Math.max(floor, it.rate - 5))}><Text style={S_.rateBtnT}>− $5</Text></TouchableOpacity>
        <TouchableOpacity style={S_.rateBtn} onPress={() => onChange(Math.max(floor, it.rate - 1))}><Text style={S_.rateBtnT}>− $1</Text></TouchableOpacity>
        <TouchableOpacity style={S_.rateBtn} onPress={() => onChange(it.rate + 1)}><Text style={S_.rateBtnT}>+ $1</Text></TouchableOpacity>
        <TouchableOpacity style={S_.rateBtn} onPress={() => onChange(it.rate + 5)}><Text style={S_.rateBtnT}>+ $5</Text></TouchableOpacity>
      </View>
      <Text style={[T.label, { fontSize: 9, marginTop: 10, color: C.mute2, textTransform: 'none', letterSpacing: 0 }]}>Award floor is the legal minimum. A fair offer fills faster.</Text>
    </View>
  );
}

// WorkFeed — the worker's available-work section, keyed by MISSION (Constitution Laws 1+2). One
// clear branch per mission instead of dense inline conditionals, so adding future mission states
// (working, done) stays clean. `mission` is computed once by the parent from the single source of
// truth (hasActiveJob / freeAndOnline).
//   'active'  — on a job → the feed RECEDES to one quiet line; the job's tracker dominates (Law 1).
//   'find'    — online + free → the feed LEADS with a bold header + live count (Laws 1,2,13).
//   'offline' — not online → jobs hidden; the online toggle is the mission.
export function WorkFeed({ mission, jobs, passed, busyId, expandedBios, setExpandedBios, onAccept, onPass, onDismissDone }) {
  const nearCount = (jobs || []).filter((d) => !passed.has(d.request_item?.id)).length;

  // WORKING: the worker is physically on site. Strip everything — the feed disappears entirely so
  // nothing competes with finishing the job (Laws 1 + 8). The tracker's Complete action is the one
  // thing on screen.
  if (mission === 'working') return null;

  // DONE: the worker just finished. Confirm the outcome warmly (the tracker above shows paid /
  // awaiting-approval), then gently pivot to the next opportunity — don't snap back to a full
  // marketplace as if nothing happened (Laws 3 + 13).
  if (mission === 'done') {
    return (
      <View style={{ marginTop: 20 }}>
        <Text style={[T.bodyStrong, { color: C.green }]}>Job done — nice work.</Text>
        <Text style={[T.small, { color: C.mute, marginTop: 3 }]}>
          {nearCount > 0
            ? `${nearCount} more job${nearCount > 1 ? 's' : ''} nearby when you're ready for the next one.`
            : "Stay online and we'll alert you when the next job appears."}
        </Text>
        <TouchableOpacity style={[S_.primary, { marginTop: 16 }]} onPress={onDismissDone} activeOpacity={0.85}>
          <Text style={S_.primaryT}>Find more work</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (mission === 'active') {
    return (
      <View style={{ marginTop: 20 }}>
        <Text style={[T.small, { color: C.mute }]}>
          {nearCount > 0
            ? `${nearCount} more job${nearCount > 1 ? 's' : ''} nearby — you'll see them when this one's done`
            : 'More work will appear here once you finish this job'}
        </Text>
      </View>
    );
  }

  if (mission === 'offline') {
    return (
      <>
        <View style={[S_.rowBetween, { marginTop: 22 }]}>
          <Text style={T.eyebrow}>Jobs near you</Text><LiveTag />
        </View>
        <Text style={[T.small, { marginTop: 8 }]}>Go online to see jobs.</Text>
      </>
    );
  }

  // mission === 'find' — the marketplace leads
  const visible = (jobs || []).filter((d) => !passed.has(d.request_item?.id));
  return (
    <>
      <View style={{ marginTop: 4, marginBottom: 4 }}>
        <View style={[S_.rowBetween, { alignItems: 'center' }]}>
          <Text style={T.heading}>Work near you</Text><LiveTag />
        </View>
        {(jobs === null || nearCount > 0) && (
          <Text style={[T.small, { color: C.mute, marginTop: 2 }]}>
            {jobs === null ? 'Looking…' : `${nearCount} job${nearCount > 1 ? 's' : ''} you can take right now`}
          </Text>
        )}
      </View>
      {jobs === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 12 }} />
        : jobs.length === 0 ? <EmptyState icon="crew" title="You're first in line" sub="You're visible to sites nearby. New work drops here the moment it's posted — you'll see it before anyone else." />
        : visible.length === 0 ? <EmptyState icon="crew" title="You're all caught up" sub="You've passed on the jobs nearby for now. New ones will appear here as they're posted." />
        : visible.map((d, i) => (
          <AvailableJobCard
            key={d.id}
            d={d}
            index={i}
            busyId={busyId}
            expanded={!!expandedBios[d.id]}
            onToggleBio={() => setExpandedBios((p) => ({ ...p, [d.id]: !p[d.id] }))}
            onAccept={onAccept}
            onPass={onPass}
          />
        ))}
    </>
  );
}

// AvailableJobCard — one job in the worker's "find work" feed. Extracted from OperatorHome so the
// mission-keyed Work-home render stays readable as the spine grows (CLAUDE.md §2). Pure presentation
// + callbacks; all decision facts a worker needs in ~2 seconds (Constitution Law 3): urgency, spots,
// trade, location, the duties brief, pay + estimate.
export function AvailableJobCard({ d, index = 0, busyId, expanded, onToggleBio, onAccept, onPass }) {
  const it = d.request_item; const r = it?.request;
  const qty = it?.qty || 1;
  const taken = d.taken || 0;
  const left = qty - taken;
  const mineHere = d.mine_accepted || 0;   // spots I personally hold on this item
  const multi = qty > 1;
  const urgent = r?.when_type === 'now';
  const rate = it?.rate != null ? it.rate : (it?.rate_offered != null ? it.rate_offered : null);
  const hours = r?.duration_hours || 4;
  const isJobPrice = it?.price_mode === 'job';
  const estTotal = rate != null && !isJobPrice ? Math.round(rate * hours) : null;

  // Settle-in: each card fades + rises into place, staggered a beat after the one above (capped so a
  // long feed doesn't feel slow). Makes the feed feel curated rather than dumped. Runs once on mount.
  // IMPORTANT: guard against refresh() remounting cards — if the animation restarted on every data
  // refresh, cards would flash then vanish (reset to opacity 0). hasEntered keeps them visible.
  const hasEntered = useRef(false);
  const enter = useRef(new Animated.Value(hasEntered.current ? 1 : 0)).current;
  useEffect(() => {
    if (hasEntered.current) { enter.setValue(1); return; }
    Animated.timing(enter, {
      toValue: 1, duration: 380, delay: Math.min(index, 6) * 55,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start(() => { hasEntered.current = true; });
  }, [enter, index]);
  const cardStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };

  const busyHere = busyId === it?.id;
  const accent = urgent ? C.amber : C.green;
  const accentSoft = urgent ? 'rgba(245,158,11,0.12)' : C.greenSoft;
  return (
    <Animated.View style={[cardStyle, { marginBottom: 14 }]}>
      <View style={jc.card}>
        {/* urgency accent bar — the eye lands here first for a "now" job */}
        <View style={[jc.accentBar, { backgroundColor: urgent ? C.amber : 'transparent' }]} />

        {/* header — trade + where, with a tinted glyph */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[jc.glyph, { backgroundColor: accentSoft }]}>
            <Icon name={iconForType(it?.type, it?.kind)} size={22} color={accent} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={jc.trade} numberOfLines={1}>{it?.type}{multi ? `  ·  ${qty}` : ''}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Icon name="pin" size={12} color={C.mute} strokeWidth={2.2} />
              <Text style={jc.where} numberOfLines={1}>{suburbOf(r?.address_text) || 'Nearby'}</Text>
            </View>
            {/* who you'd work for — so the worker never accepts blind */}
            {(() => {
              const rep = d.client_rep;
              const rated = rep && rep.client_rating_count > 0;
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                  <Icon name="star" size={11} color={rated ? C.amber : C.mute2} strokeWidth={2.2} fill={rated ? C.amber : 'none'} />
                  <Text style={{ fontSize: 11.5, color: C.mute, fontWeight: '700' }}>
                    {rated ? `${Number(rep.client_rating).toFixed(1)} · ${rep.client_rating_count} job${rep.client_rating_count === 1 ? '' : 's'} posted` : 'New client'}
                  </Text>
                </View>
              );
            })()}
          </View>
          <View style={[jc.badge, { backgroundColor: urgent ? 'rgba(245,158,11,0.14)' : C.panel2 }]}>
            <Text style={[jc.badgeT, { color: urgent ? C.amber : C.mute }]}>{urgent ? '⚡ Now' : 'Booked'}</Text>
          </View>
        </View>

        {/* what they'll be doing — the trust piece */}
        {r?.job_details ? (
          <TouchableOpacity activeOpacity={0.7} onPress={onToggleBio} style={{ marginTop: 14 }}>
            <Text style={jc.bio} numberOfLines={expanded ? undefined : 2}>{r.job_details}</Text>
            {r.job_details.length > 90 && <Text style={[jc.bioMore, { color: accent }]}>{expanded ? 'Show less' : 'Read more'}</Text>}
          </TouchableOpacity>
        ) : null}

        {/* PAY — the number the worker decides on, and the open-spots chip */}
        {rate != null && (
          <View style={jc.payRow}>
            <View>
              <Text style={jc.payLabel}>You earn</Text>
              <Text style={jc.payBig}>${rate}<Text style={jc.payUnit}>{isJobPrice ? '/job' : '/hr'}</Text></Text>
              {estTotal != null && <Text style={jc.payEst}>≈ ${estTotal} · {hours} hrs</Text>}
            </View>
            {left > 0 && multi && (
              <View style={jc.spots}>
                <Text style={jc.spotsN}>{left}</Text>
                <Text style={jc.spotsL}>of {qty} open</Text>
              </View>
            )}
          </View>
        )}

        {/* multi-spot pips */}
        {multi && (
          <View style={[S_.pips, { marginTop: 12 }]}>
            {Array.from({ length: qty }).map((_, i) => (<View key={i} style={[S_.pip, i < taken && S_.pipFilled]} />))}
            <Text style={[T.label, { fontSize: 9, marginLeft: 6 }]}>{taken}/{qty} filled</Text>
          </View>
        )}

        {mineHere > 0 && (
          <View style={jc.mine}><Text style={jc.mineT}>✓ You've taken {mineHere} spot{mineHere > 1 ? 's' : ''}</Text></View>
        )}

        {/* the ACCEPT — big, green, unmistakable */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => left > 0 && onAccept(it.id)}
          disabled={left <= 0 || busyHere}
          style={[jc.accept, left <= 0 ? jc.acceptOff : null]}
        >
          {busyHere ? <ActivityIndicator color="#fff" />
            : <Text style={jc.acceptT}>{left <= 0 ? 'All filled' : mineHere > 0 ? 'Take another spot' : 'Accept job'}</Text>}
        </TouchableOpacity>
        {mineHere <= 0 && left > 0 && (
          <TouchableOpacity onPress={() => onPass(it.id)} style={jc.pass} activeOpacity={0.7}>
            <Text style={jc.passT}>Pass</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const jc = StyleSheet.create({
  card: {
    backgroundColor: C.panel, borderRadius: 22, padding: 18, paddingTop: 20, borderWidth: 1, borderColor: C.line, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  accentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  glyph: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  trade: { fontSize: 17.5, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  where: { fontSize: 13, color: C.mute, fontWeight: '600' },
  badge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  badgeT: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.2 },
  bio: { fontSize: 13.5, color: C.ink2 || C.ink, lineHeight: 19, fontWeight: '500' },
  bioMore: { fontSize: 12.5, fontWeight: '800', marginTop: 4 },
  payRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.line },
  payLabel: { fontSize: 10.5, fontWeight: '800', color: C.mute, letterSpacing: 0.5, textTransform: 'uppercase' },
  payBig: { fontSize: 32, fontWeight: '900', color: C.ink, letterSpacing: -1.2, marginTop: 3 },
  payUnit: { fontSize: 15, fontWeight: '700', color: C.mute, letterSpacing: 0 },
  payEst: { fontSize: 13, color: C.green, fontWeight: '800', marginTop: 3 },
  spots: { backgroundColor: C.greenSoft, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  spotsN: { fontSize: 18, fontWeight: '900', color: C.green, letterSpacing: -0.5 },
  spotsL: { fontSize: 9.5, fontWeight: '800', color: C.green, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 1 },
  mine: { backgroundColor: C.greenSoft, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, marginTop: 12 },
  mineT: { fontSize: 12.5, color: C.green, fontWeight: '800' },
  accept: {
    marginTop: 16, backgroundColor: C.green, borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    shadowColor: C.green, shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  acceptOff: { backgroundColor: '#C9CBD3', shadowOpacity: 0 },
  acceptT: { color: '#fff', fontSize: 16.5, fontWeight: '800', letterSpacing: 0.2 },
  pass: { alignItems: 'center', paddingVertical: 13, marginTop: 2 },
  passT: { color: C.mute, fontSize: 13.5, fontWeight: '700' },
});

export function TaskPriceCard({ it, onChange }) {
  const PRESETS = [20, 40, 60, 80, 100];
  return (
    <View style={[S_.card, { marginBottom: 12 }]}>
      <View style={S_.rowBetween}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="task" size={16} color={C.ink} /><Text style={T.bodyStrong}>{it.type}</Text></View>
        <Text style={T.money}>${it.rate}<Text style={{ fontSize: 12, color: C.mute }}>/job</Text></Text>
      </View>
      <Text style={[T.small, { color: C.mute, marginTop: 2, marginBottom: 12 }]}>Community runner — a flat price for the whole job.</Text>

      <View style={S_.presetRow}>
        {PRESETS.map((p) => (
          <TouchableOpacity key={p} style={[S_.preset, it.rate === p && S_.presetOn]} onPress={() => onChange(p)}>
            <Text style={[S_.presetT, it.rate === p && S_.presetTOn]}>${p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[S_.rateBtns, { marginTop: 10 }]}>
        <TouchableOpacity style={S_.rateBtn} onPress={() => onChange(Math.max(5, it.rate - 5))}><Text style={S_.rateBtnT}>− $5</Text></TouchableOpacity>
        <TouchableOpacity style={S_.rateBtn} onPress={() => onChange(it.rate + 5)}><Text style={S_.rateBtnT}>+ $5</Text></TouchableOpacity>
      </View>
    </View>
  );
}

export function MiniReqCard({ r, onOpen }) {
  const items = r.request_items || [];
  // live counts + lifecycle progress (not just fill)
  let needed = 0, filled = 0, committed = 0, moving = 0, onsite = 0, done = 0, stageSum = 0;
  const STAGE_PCT = { accepted: 0.15, committed: 0.15, en_route: 0.45, on_site: 0.75, complete: 1, approved: 1 };
  items.forEach((it) => {
    const live = (it.assignments || []).filter((a) => a.status !== 'cancelled');
    needed += it.qty || 1;
    filled += live.length;
    committed += live.filter((a) => ['committed', 'accepted'].includes(a.status)).length;
    moving += live.filter((a) => ['en_route', 'on_site'].includes(a.status)).length;
    onsite += live.filter((a) => a.status === 'on_site').length;
    done += live.filter((a) => ['complete', 'approved'].includes(a.status)).length;
    live.forEach((a) => { stageSum += STAGE_PCT[a.status] || 0; });
  });
  const suburb = (r.address_text || 'No location').split(',')[0];
  const allDone = needed > 0 && done >= needed;
  const settled = r.status === 'complete' && r.settle_net != null;
  // progress = average lifecycle position across all needed spots (empty spots count as 0)
  const pct = needed ? Math.round((stageSum / needed) * 100) : 0;

  const stalled = requestHasStall(r);
  const state = settled ? { t: 'Complete · paid', c: C.green }
    : allDone ? { t: 'Ready to approve', c: C.indigo }
    : filled === 0 ? { t: 'Finding workers…', c: C.mute }
    : onsite > 0 ? { t: `On site · ${onsite}/${needed}`, c: C.indigo }
    : moving > 0 ? { t: `On the way · ${moving}/${needed}`, c: C.indigo }
    : stalled ? { t: 'Not started yet', c: C.amber }
    : { t: `Getting ready · ${committed}/${needed}`, c: C.ink };   // committed, not travelling

  return (
    <TouchableOpacity style={S_.miniCard} onPress={onOpen} activeOpacity={0.7}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {r.when_type === 'now' && <View style={S_.urgentDot} />}
        <Text style={[T.bodyStrong, { flex: 1 }]} numberOfLines={1}>{suburb}</Text>
        <View style={[S_.pill, { backgroundColor: state.c === C.green ? C.greenSoft : state.c === C.indigo ? C.indigoSoft : state.c === C.amber ? C.amberSoft : C.panel2 }]}>
          <Text style={[S_.pillT, { color: state.c }]}>{state.t}</Text>
        </View>
        <Text style={{ color: C.mute2, fontSize: 16, marginLeft: 2 }}>›</Text>
      </View>
      <Text style={[T.small, { color: C.mute, marginTop: 3 }]} numberOfLines={1}>
        {items.map((it) => it.qty > 1 ? `${it.type} ×${it.qty}` : it.type).join(' · ')}
      </Text>
      <View style={S_.progThin}><View style={[S_.progThinFill, { width: `${Math.max(pct, 4)}%`, backgroundColor: allDone ? C.green : filled === 0 ? C.line2 : C.indigo }]} /></View>
    </TouchableOpacity>
  );
}

export function statusMeta(r) {
  const items = r.request_items || [];
  const live = (it) => (it.assignments || []).filter((a) => a.status !== 'cancelled');
  const needed = items.reduce((n, it) => n + (it.qty || 1), 0);
  const filled = items.reduce((n, it) => n + live(it).length, 0);
  const DONE = ['complete', 'approved'];
  const done = items.reduce((n, it) => n + live(it).filter((a) => DONE.includes(a.status)).length, 0);
  const allDone = needed > 0 && done >= needed;
  let bucket = 'open';
  if (r.status === 'cancelled') bucket = 'cancelled';
  else if (r.status === 'complete') bucket = 'complete';       // approved + settled
  else if (allDone) bucket = 'ready';                          // work done, awaiting client approval
  else if (needed > 0 && filled >= needed) bucket = 'filled';  // all spots taken, work ongoing
  else if (filled > 0) bucket = 'filling';                     // some spots taken
  return { needed, filled, done, allDone, bucket };
}

/* Live stage tracker — client watches the same lifecycle the operator drives.
   Reads assignment.status + its job_events for check-in proof (time, flag). */
/* The introduction — who committed. Shows for committed/en_route/on_site spots.
   Verified capability = the item's own trade (operator was accept-gated on it). */
export function OperatorCard({ a, tradeType }) {
  const op = a.operator || {};
  const name = (op.full_name || 'Operator').split(' ')[0];
  const rating = op.rating != null ? Number(op.rating).toFixed(1) : null;
  const jobs = op.jobs_done;
  const vehicle = op.vehicle_type;
  const committed = a.status === 'committed' || a.status === 'accepted';
  const eta = a.eta_baseline_min;
  // prefer LIVE distance (counting down) over the static start distance
  const liveM = a.live_dist_m != null ? Number(a.live_dist_m) : null;
  const startM = a.start_dist_m != null ? Number(a.start_dist_m) : null;
  const useM = liveM != null ? liveM : startM;
  const distKm = useM != null ? useM / 1000 : null;
  const distLabel = distKm != null ? (distKm < 1 ? 'less than 1 km' : `~${distKm.toFixed(distKm < 10 ? 1 : 0)} km`) : null;
  // honest staleness: if last ping > 60s ago, say "last seen", don't fake live
  const liveAgeS = a.live_at ? Math.round((Date.now() - new Date(a.live_at).getTime()) / 1000) : null;
  const stale = liveAgeS != null && liveAgeS > 60;
  const liveTag = liveM != null && !stale ? ' away' : stale ? ` away · last seen ${liveAgeS < 120 ? '1 min' : Math.round(liveAgeS / 60) + ' min'} ago` : ' away';

  const statusLine = committed ? { t: 'Getting ready to leave', c: C.ink }
    : a.status === 'en_route' ? { t: distLabel ? `On the way · ${distLabel}${liveTag}` : (eta ? `On the way · ~${eta} min` : 'On the way'), c: C.indigo }
    : a.status === 'on_site' ? { t: 'On site now', c: C.green }
    : { t: 'Job done', c: C.green };

  return (
    <View style={S_.opCard}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={S_.opAvatar}><Text style={S_.opAvatarT}>{name.charAt(0).toUpperCase()}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={[T.bodyStrong, { fontSize: 15 }]}>{name}</Text>
          <Text style={[T.small, { color: C.mute, marginTop: 1 }]}>
            {repLine(op)}{vehicle ? `  ·  ${vehicle}` : ''}
          </Text>
        </View>
        <Text style={[T.label, { fontSize: 10, color: statusLine.c }]}>{statusLine.t}</Text>
      </View>
      <View style={S_.opCapRow}>
        <Text style={S_.opCapChip}>✓ {tradeType}</Text>
      </View>
    </View>
  );
}

export function StageTracker({ a, spotLabel }) {
  const STAGES = [
    ['committed', 'Committed'],
    ['en_route', 'On the way'],
    ['on_site', 'On site'],
    ['complete', 'Complete'],
  ];
  // where along the path are we? (approved counts as past complete; legacy 'accepted' = committed)
  const order = { accepted: 0, committed: 0, en_route: 1, on_site: 2, complete: 3, approved: 3 };
  const at = order[a.status] ?? 0;

  // pull the check-in event for the arrival proof line
  const events = a.job_events || [];
  const checkin = events.find((e) => e.kind === 'checkin');
  const checkinTime = checkin ? new Date(checkin.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const flagged = checkin?.context?.flagged;
  const dist = checkin?.distance_m != null ? Math.round(checkin.distance_m) : null;

  return (
    <View style={S_.track}>
      {spotLabel && <Text style={[T.label, { fontSize: 9, marginBottom: 6 }]}>{spotLabel}</Text>}
      <View style={S_.trackRow}>
        {STAGES.map(([key, label], i) => {
          const reached = i <= at;                 // this stage has been reached/completed
          const isNext = i === at + 1;              // the upcoming stage (subtle emphasis)
          return (
            <View key={key} style={S_.trackStep}>
              <View style={S_.trackLineWrap}>
                {i > 0 && <View style={[S_.trackLine, reached && S_.trackLineOn]} />}
                <View style={[S_.dot, reached && S_.dotOn, isNext && S_.dotNow]}>
                  {reached && <Text style={S_.dotTick}>✓</Text>}
                </View>
                {i < STAGES.length - 1 && <View style={[S_.trackLine, i < at && S_.trackLineOn]} />}
              </View>
              <Text style={[S_.trackLabel, reached && { color: C.ink, fontWeight: '600' }]}>{label}</Text>
            </View>
          );
        })}
      </View>
      {/* arrival proof line */}
      {checkinTime && (
        <Text style={[T.small, { marginTop: 6, color: flagged ? C.amber : C.green }]}>
          {flagged
            ? `⚠ Checked in ${checkinTime}${dist != null ? ` · ${dist}m from site (flagged)` : ' (location unverified)'}`
            : `✓ Arrived on site, verified ${checkinTime}${dist != null ? ` · ${dist}m` : ''}`}
        </Text>
      )}
    </View>
  );
}

export function FullReqCard({ r, busy, onApprove, onCancel, onRepost, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [showSpots, setShowSpots] = useState(false);   // trackers hidden by default once all done
  const [confirmCancel, setConfirmCancel] = useState(false);
  const items = r.request_items || [];
  const { needed, filled, done, bucket } = statusMeta(r);
  const canApprove = needed > 0 && done === needed && r.status !== 'complete';
  const stageLabel = { accepted: 'Accepted', en_route: 'On the way', on_site: 'On site', complete: 'Complete', approved: 'Paid ✓' };
  const isSettled = r.status === 'complete' && r.settle_total != null;
  const isCancelled = r.status === 'cancelled';
  const bucketColor = bucket === 'complete' ? C.green : bucket === 'filled' ? C.indigo : bucket === 'filling' ? C.indigo : C.mute;
  const pct = needed ? Math.round((done / needed) * 100) : 0;

  // payout preview (before approval): mirrors server settlement exactly.
  //   price_mode 'job' = flat rate; else rate * hours. rate is the client's set price.
  const hours = r.duration_hours || 4;
  let payTotal = 0, workers = 0;
  items.forEach((it) => {
    const rate = Number(it.rate ?? it.rate_offered ?? 0);
    const per = it.price_mode === 'job' ? rate : rate * hours;
    (it.assignments || []).filter((a) => ['complete', 'approved'].includes(a.status)).forEach(() => { payTotal += per; workers += 1; });
  });
  const payNet = Math.round(payTotal * 0.90); // after 10% platform fee (labour); tasks/tips/travel are 100% to worker
  const payLabel = payNet > 0 ? `Approve — pay $${payNet.toLocaleString()} to ${workers} ${workers === 1 ? 'worker' : 'workers'}` : 'Approve & settle';

  const stalled = requestHasStall(r);
  // one-glance status word
  const statusWord = isCancelled ? 'Cancelled'
    : isSettled ? 'Settled'
    : canApprove ? 'Ready to approve'
    : stalled ? 'Not started yet'
    : filled >= needed && needed > 0 ? 'In progress'
    : filled > 0 ? `Filling ${filled}/${needed}`
    : 'Waiting';
  const statusColor = isCancelled ? C.mute : isSettled ? C.green : canApprove ? C.indigo : stalled ? C.amber : filled > 0 ? C.indigo : C.mute;

  return (
    <View style={[S_.reqCard, open && S_.reqCardOpen]}>
      {/* COLLAPSED: one tight tappable row */}
      <TouchableOpacity activeOpacity={0.7} onPress={() => setOpen(!open)} style={S_.reqHead}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {r.when_type === 'now' && <View style={S_.urgentDot} />}
            <Text style={[T.bodyStrong, { flex: 1 }]} numberOfLines={1}>{jobTitle(items)}</Text>
          </View>
          <Text style={[T.small, { color: C.mute, marginTop: 2 }]} numberOfLines={1}>
            {jobSubtitle(items, r)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}>
          <View style={[S_.pill, { backgroundColor: statusColor === C.green ? C.greenSoft : statusColor === C.indigo ? C.indigoSoft : statusColor === C.amber ? C.amberSoft : C.panel2 }]}>
            <Text style={[S_.pillT, { color: statusColor }]}>{statusWord}</Text>
          </View>
          <Text style={{ color: C.mute2, fontSize: 11 }}>{open ? '▲' : '▾'}</Text>
        </View>
      </TouchableOpacity>

      {/* thin progress line, always visible — the only always-on visual */}
      {!isSettled && (
        <View style={S_.progThin}><View style={[S_.progThinFill, { width: `${pct}%` }]} /></View>
      )}

      {/* EXPANDED detail */}
      {open && (
        <View style={S_.reqBody}>
          {/* stalled: an operator committed but never started — give the client a way out */}
          {stalled && !canApprove && !isSettled && !isCancelled && (
            <View style={S_.stallBanner}>
              <Text style={S_.stallTitle}>Worker hasn't started</Text>
              <Text style={S_.stallSub}>Someone accepted but hasn't set off. You can re-post this to notify other workers nearby.</Text>
              <TouchableOpacity style={S_.stallBtn} onPress={onRepost} disabled={busy} activeOpacity={0.9}>
                <Text style={S_.stallBtnT}>{busy ? 'Re-posting…' : '↻ Release & re-post'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {canApprove ? (
            /* ALL DONE — a calm, satisfying summary instead of repetitive trackers */
            <View style={S_.doneWrap}>
              <View style={S_.doneCheck}><Text style={S_.doneCheckT}>✓</Text></View>
              <Text style={S_.doneTitle}>All {needed === 1 ? 'work' : `${needed} spots`} complete</Text>
              <Text style={S_.doneSub}>
                {items.map((it) => it.qty > 1 ? `${it.type} ×${it.qty}` : it.type).join(' · ')}{r.address_text ? ` · ${r.address_text.split(',')[0]}` : ''}
              </Text>
              <TouchableOpacity onPress={() => setShowSpots((s) => !s)} style={{ marginTop: 10 }}>
                <Text style={[T.label, { fontSize: 10, color: C.mute }]}>{showSpots ? 'Hide spot detail ▲' : 'See each spot ▾'}</Text>
              </TouchableOpacity>
              {showSpots && items.map((it) => (
                (it.assignments || []).filter((x) => x.status !== 'cancelled').map((x, k) => (
                  <StageTracker key={x.id || k} a={x} spotLabel={it.qty > 1 ? `Spot ${k + 1}` : null} />
                ))
              ))}
            </View>
          ) : items.map((it) => {
            const a = (it.assignments || []).filter((x) => x.status !== 'cancelled');
            const c = a.filter((x) => x.status === 'complete' || x.status === 'approved').length;
            return (
              <View key={it.id} style={S_.detailItem}>
                <View style={S_.rowBetween}>
                  <Text style={[T.bodyStrong, { fontSize: 14 }]}>{it.type}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text>
                  {!isCancelled && <Text style={[T.data, { color: c >= it.qty ? C.green : C.mute }]}>{c}/{it.qty}</Text>}
                </View>
                {isCancelled
                  ? <Text style={[T.small, { marginTop: 3, color: C.mute }]}>This job was cancelled.</Text>
                  : a.length === 0
                  ? <Text style={[T.small, { marginTop: 3 }]}>Waiting for a worker to accept…</Text>
                  : a.map((x, k) => (
                      <View key={x.id || k}>
                        <OperatorCard a={x} tradeType={it.type} />
                        <StageTracker a={x} spotLabel={it.qty > 1 ? `Spot ${k + 1}` : null} />
                      </View>
                    ))}
              </View>
            );
          })}
          <Text style={[T.label, { fontSize: 9, marginTop: 6 }]}>Posted {new Date(r.created_at).toLocaleString()}</Text>

          {/* cancel — available any stage before settlement */}
          {r.status !== 'complete' && r.status !== 'cancelled' && (
            confirmCancel ? (
              <View style={{ marginTop: 12, gap: 8 }}>
                <Text style={[T.small, { color: C.amber }]}>Cancel this job? Any workers on it will be released. You won’t be charged — any card hold is released back to you.</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[S_.dangerBtn, { flex: 1 }]} onPress={onCancel} disabled={busy}>
                    <Text style={S_.dangerBtnT}>Yes, cancel job</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[S_.ghostBtn, { flex: 1 }]} onPress={() => setConfirmCancel(false)} disabled={busy}>
                    <Text style={S_.ghostBtnT}>Keep it</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setConfirmCancel(true)} style={{ marginTop: 12 }} disabled={busy}>
                <Text style={[T.data, { color: C.mute, textDecorationLine: 'underline' }]}>Cancel this job</Text>
              </TouchableOpacity>
            )
          )}

          {/* re-post — bring a cancelled job back to the pool as a fresh request */}
          {r.status === 'cancelled' && (
            <TouchableOpacity style={[S_.repostBtn, { marginTop: 12 }]} onPress={onRepost} disabled={busy} activeOpacity={0.9}>
              <Text style={S_.repostBtnT}>↻ Re-post to the pool</Text>
            </TouchableOpacity>
          )}

          {/* settlement detail only when expanded */}
          {isSettled && (
            <View style={S_.settle}>
              <Text style={[T.label, { color: C.green, marginBottom: 10 }]}>✓ Settled</Text>
              <View style={S_.reviewRow}><Text style={T.small}>Job total</Text><Text style={T.data}>${Number(r.settle_total).toLocaleString()}</Text></View>
              <View style={S_.reviewRow}><Text style={T.small}>Platform fee</Text><Text style={T.data}>−${Number(r.settle_fee).toLocaleString()}</Text></View>
              <View style={[S_.reviewRow, { borderTopWidth: 1, borderTopColor: C.line, marginTop: 7, paddingTop: 11 }]}>
                <Text style={T.bodyStrong}>Paid to worker</Text><Text style={[T.money, { color: C.ink }]}>${Number(r.settle_net).toLocaleString()}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* approve CTA — always reachable when ready (doesn't need expand) */}
      {canApprove && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, paddingTop: open ? 0 : 12 }}>
          <PrimaryBtn label={payLabel} onPress={onApprove} busy={busy} />
        </View>
      )}
    </View>
  );
}


export function AccountSection({ title, rows }) {
  return (
    <>
      <Text style={[T.eyebrow, { marginTop: 8 }]}>{title}</Text>
      <View style={[S_.card, { paddingVertical: 4 }]}>
        {rows.map(([icon, label, val, onPress], i) => {
          // A not-yet feature ('Soon') should read as a quiet tag, not an active indigo action —
          // otherwise the whole screen looks half-built. 'Active' reads as a live green state.
          const isSoon = val === 'Soon';
          const isActive = val === 'Active';
          const content = (
            <View style={[S_.acctRow, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.line2 }]}>
              <View style={{ width: 30 }}><Icon name={icon} size={19} color={isSoon ? C.mute2 : C.mute} strokeWidth={1.9} /></View>
              <Text style={[T.body, { flex: 1, color: isSoon ? C.mute : C.ink }]}>{label}</Text>
              {isSoon
                ? <View style={{ backgroundColor: C.panel2, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}><Text style={[T.tiny, { color: C.mute2, fontWeight: '700', letterSpacing: 0.3 }]}>Soon</Text></View>
                : <Text style={[T.data, { color: isActive ? C.green : (onPress ? C.indigo : C.mute) }]}>{val}</Text>}
            </View>
          );
          return onPress
            ? <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>
            : <View key={label}>{content}</View>;
        })}
      </View>
    </>
  );
}

export function RoleChip({ label, on, onPress, accent, locked }) {
  return (
    <TouchableOpacity style={[S_.roleChip, on && { backgroundColor: accent || C.indigo }]} onPress={onPress}>
      <Text style={[S_.roleChipT, on && S_.roleChipTOn]}>{label}</Text>
      {locked && !on ? <Text style={S_.roleChipLock}> 🔒</Text> : null}
    </TouchableOpacity>
  );
}
export function QuickTile({ icon, label, onPress }) {
  return <TouchableOpacity style={S_.quickTile} onPress={onPress} activeOpacity={0.85}><Icon name={icon} size={24} color={C.indigo} strokeWidth={1.8} /><Text style={[T.bodyStrong, { fontSize: 13, marginTop: 8 }]}>{label}</Text></TouchableOpacity>;
}
export function AddBtn({ label, onPress }) {
  return <TouchableOpacity style={S_.addBtn} onPress={onPress}><Text style={{ color: C.indigo, fontWeight: '700', fontSize: 13.5 }}>{label}</Text></TouchableOpacity>;
}
export function AddressField({ value, onChangeText, onPick, picked, disabled }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const timer = React.useRef(null);

  function change(t) {
    onChangeText(t);
    setErr('');
    if (timer.current) clearTimeout(timer.current);
    if (!t || t.trim().length < 3) { setResults([]); return; }
    // debounce ~600ms (Nominatim politeness: <=1 req/sec)
    timer.current = setTimeout(async () => {
      setLoading(true);
      try { setResults(await searchAddress(t)); }
      catch (_) { setErr('Address lookup unavailable — you can still type it.'); }
      finally { setLoading(false); }
    }, 600);
  }

  return (
    <View>
      <View style={{ position: 'relative' }}>
        <TextInput
          style={[S_.input, picked && { borderColor: C.green }]}
          placeholder="Start typing an address…"
          placeholderTextColor={C.mute2}
          value={value}
          onChangeText={change}
          editable={!disabled}
          autoCorrect={false}
        />
        {picked && <Text style={{ position: 'absolute', right: 12, top: 14, color: C.green, fontSize: 14 }}>✓</Text>}
        {loading && <ActivityIndicator size="small" color={C.indigo} style={{ position: 'absolute', right: 12, top: 12 }} />}
      </View>
      {!!err && <Text style={[T.small, { color: C.amber, marginTop: 6 }]}>{err}</Text>}
      {results.length > 0 && !picked && (
        <View style={S_.addrList}>
          {results.map((r, i) => (
            <TouchableOpacity key={i} onPress={() => { onPick(r); setResults([]); }} style={S_.addrRow}>
              <Text style={[T.data, { color: C.ink }]} numberOfLines={2}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {!picked && value.trim().length >= 3 && results.length === 0 && !loading && (
        <Text style={[T.small, { color: C.mute, marginTop: 6 }]}>Pick a suggestion so we can pin the site for check-in.</Text>
      )}
    </View>
  );
}

export function MiniBtn({ label, onPress }) {
  return <TouchableOpacity style={S_.miniBtn} onPress={onPress}><Text style={[T.small, { fontWeight: '600' }]}>{label}</Text></TouchableOpacity>;
}
export function SegBtn({ label, on, onPress }) {
  return <TouchableOpacity style={[S_.segBtn, on && S_.segBtnOn]} onPress={onPress}><Text style={[S_.segT, on && S_.segTOn]}>{label}</Text></TouchableOpacity>;
}
export function LiveTag() {
  return <View style={S_.live}><View style={S_.liveDot} /><Text style={[T.label, { fontSize: 9, color: C.green }]}>Live</Text></View>;
}
// Safe haptic tap. expo-haptics auto-installs in Snack; wrap in try/catch so a haptics failure
// can NEVER break a critical action button (Constitution Law 11 — money/safety paths must not fail
// on a cosmetic dependency). No-ops silently if unavailable.
let _Haptics = null;
try { _Haptics = require('expo-haptics'); } catch (_) {}
export function tap(kind = 'light') {
  try {
    if (!_Haptics) return;
    const style = kind === 'success' ? _Haptics.NotificationFeedbackType?.Success
      : kind === 'medium' ? _Haptics.ImpactFeedbackStyle?.Medium
      : _Haptics.ImpactFeedbackStyle?.Light;
    if (kind === 'success') _Haptics.notificationAsync?.(style);
    else _Haptics.impactAsync?.(style);
  } catch (_) {}
}

// StepFade — softly fades the request-flow step content in whenever the phase changes, so steps
// transition gently instead of hard-cutting. Opacity ONLY + useNativeDriver, so it can never
// disturb the ScrollView layout or the keyboard on the address step.
export function StepFade({ phase, children }) {
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [phase, fade]);
  return <Animated.View style={{ opacity: fade }}>{children}</Animated.View>;
}

export function PrimaryBtn({ label, onPress, busy, disabled }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: M.pressScale, useNativeDriver: true, ...M.springSnappy }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...M.springSnappy }).start();
  const handlePress = () => { tap('medium'); onPress && onPress(); };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[S_.primary, (disabled || busy) && S_.primaryOff]}
        onPress={handlePress}
        onPressIn={!(disabled || busy) ? pressIn : undefined}
        onPressOut={!(disabled || busy) ? pressOut : undefined}
        disabled={disabled || busy}
        activeOpacity={0.9}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={S_.primaryT}>{label}</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
}
export const Center = ({ children }) => <View style={[S_.fill, { alignItems: 'center', justifyContent: 'center' }]}>{children}</View>;

export function estTotal(items) {
  let t = 0; items.forEach((it) => { if (it.rate != null) t += it.rate * (it.kind === 'task' ? 1 : 4) * (it.qty || 1); });
  return t;
}
// premium: short suburb from a full address ("Richmond, NSW, 2753, AU" -> "Richmond")

// Turn a pile of request items into a clean job title. Research-backed (Airbnb title method):
// lead with the CATEGORY word — here, the primary trade — not a headcount or adjective, because
// the trade IS the job's identity and is what a tradie recognises fastest when scanning.
export function jobCrewSize(items) {
  return (items || []).reduce((n, it) => n + (it.qty || 1), 0);
}
export function jobTitle(items) {
  const list = items || [];
  if (list.length === 0) return 'Job';
  if (list.length === 1) {
    const it = list[0];
    return it.qty > 1 ? `${it.type} · ${it.qty} needed` : it.type;
  }
  // multiple trades: lead with the trade needing the most people (the "main" work),
  // then note how many other roles round out the job — "Excavator + 3 more".
  const lead = [...list].sort((a, b) => (b.qty || 1) - (a.qty || 1))[0];
  const others = list.length - 1;
  return `${lead.type} + ${others} more`;
}
export function jobSubtitle(items, r) {
  const list = items || [];
  const where = suburbOf(r && r.address_text);
  const total = jobCrewSize(list);
  if (list.length <= 1) return where;
  // subtitle carries the scale + where, so the crew size is still visible at a glance
  return `${total} workers · ${where}`;
}

// Compact job-context rows for the top of a message room — handy for both sides.
