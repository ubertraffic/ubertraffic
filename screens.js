// screens.js — Operator screens extracted from App.js (paste-size fix).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Animated, Easing, Modal, KeyboardAvoidingView, Platform, SafeAreaView, StatusBar } from 'react-native';
import { C, R, S, E, M, T, Z } from './theme';
import { SH, S_ } from './styles';
import Icon, { iconForType } from './Icon';
import { supabase } from './supabaseClient';
import MapHero from './MapHero';
import LiveTrackerCard from './LiveTrackerCard';
import Pulse from './Pulse';
import JobChat from './JobChat';
import { jobTitle, jobSubtitle, estTotal, RateCard, WorkFeed, AvailableJobCard, TaskPriceCard, MiniReqCard, statusMeta, OperatorCard, StageTracker, FullReqCard, AccountSection, RoleChip, QuickTile, AddBtn, AddressField, MiniBtn, SegBtn, LiveTag, PrimaryBtn, tap, Center } from './components2';
import { friendly, suburbOf, MatchCard, EmptyState, workerLine, repLine, requestHasStall, isStalledAssignment, autoReleaseIn, MaterialsClaim } from './components';
import CredentialsScreen from './CredentialsScreen';
import TradePicker from './TradePicker';
import { getTrackerState, advanceAssignment, cancelAssignment, checkIn, checkOut, getOperatorMapJobs, reportMissedCheckout, startJourney, updateMyLocation } from './completionService';
import CloseOutCard from './CloseOutCard';

// local copy (App.js has its own) — small pure helper, avoids a circular screens<->App import
function buildJobInfo({ a, it, r, workerName }) {
  const rows = [];
  const who = workerName || a?.operator?.full_name;
  if (who) rows.push({ label: 'Worker', value: who.split(' ')[0] });
  if (it?.type) rows.push({ label: 'Job', value: it.type });
  if (r?.address_text) rows.push({ label: 'Site', value: r.address_text });
  if (r?.site_contact_name) {
    const c = r.site_contact_phone ? `${r.site_contact_name} · ${r.site_contact_phone}` : r.site_contact_name;
    rows.push({ label: 'Ask for', value: c });
  }
  const rate = it?.rate_amount ?? it?.rate ?? a?.gross_amount;
  if (rate != null) rows.push({ label: 'Rate', value: `$${rate}${it?.rate_unit ? '/' + it.rate_unit : ''}` });
  if (a?.status) rows.push({ label: 'Status', value: statusWords(a.status) });
  return rows.length ? rows : null;
}
function statusWords(s) {
  return s === 'en_route' ? 'On the way' : s === 'on_site' ? 'On site'
    : s === 'complete' ? 'Complete' : s === 'approved' ? 'Approved' : 'Committed';
}
import { useRealtime } from './useRealtime';
import { cacheGet, cacheSet, cacheClearAll } from './screenCache';
import { setRole, setOnline, setVehicle, getMyProfile, updateMyName, setMyOperatorLocation, addCapability, listMyCapabilities, removeCapability, listMyDispatches, acceptSpot, listMyAssignments, getDemandHeat } from './operatorService';
import { getPosition, watchPosition } from './location';
import { getUnreadCounts } from './messagesService';
import { readinessForTrades } from './credentialsService';
import { unregisterPush } from './pushService';
import { logError } from './errorService';

// local copy (App.js has its own) — small, avoids a circular screens<->App import
function TrackerContainer({ requestId, onAction, perspective = 'client' }) {
  const [state, setState] = useState(null);
  const aliveRef = useRef(true);
  const refresh = React.useCallback(async () => {
    if (!requestId) return;
    try { const s = await getTrackerState(requestId, perspective); if (aliveRef.current) setState(s); } catch (_) {}
  }, [requestId, perspective]);
  useEffect(() => { aliveRef.current = true; refresh(); return () => { aliveRef.current = false; }; }, [refresh]);
  useRealtime(['assignments', 'requests'], refresh);
  useEffect(() => {
    if (!state || !['en_route', 'finding'].includes(state.stage)) return;
    const everyMs = state.stage === 'finding' ? 5000 : 15000;
    const t = setInterval(refresh, everyMs);
    return () => clearInterval(t);
  }, [state?.stage, refresh]);
  if (!state || !state.exists) return null;
  return <LiveTrackerCard state={state} onAction={onAction} />;
}

// CloseOutSheet — the compliance gate as a bottom sheet with ONE clean motion.
// The card slides up on a native-driver translateY (M.spring "sheet-rise") and
// slides back down on close, with the backdrop fading in step. We drive the
// animation ourselves (Modal animationType="none") instead of layering our
// layout inside the Modal's built-in slide, which competed with it and stuttered.
// We keep the sheet mounted through the exit so the slide-down actually plays,
// holding the last assignmentId so CloseOutCard stays rendered while it leaves.
function CloseOutSheet({ assignmentId, onComplete, onCancel }) {
  const [mounted, setMounted] = useState(!!assignmentId);
  const [content, setContent] = useState(assignmentId);   // held through exit
  const a = useRef(new Animated.Value(0)).current;         // 0 = hidden, 1 = shown
  const sheetH = useRef(600);                              // measured for offscreen travel
  useEffect(() => {
    if (assignmentId) {
      setContent(assignmentId);
      setMounted(true);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, ...M.spring }).start();
    } else if (mounted) {
      Animated.timing(a, { toValue: 0, duration: M.fast, easing: Easing.in(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
    // `mounted` intentionally omitted: this reacts to assignmentId open/close only.
  }, [assignmentId, a]);
  if (!mounted) return null;
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [sheetH.current, 0] });
  const backdrop = a.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdrop }} />
        <Animated.View
          pointerEvents={assignmentId ? 'auto' : 'none'}
          onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h) sheetH.current = h; }}
          style={{ maxHeight: '100%', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0, transform: [{ translateY }] }}
        >
          <SafeAreaView>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: S.md }}
              showsVerticalScrollIndicator={false}
            >
              {content ? (
                <CloseOutCard assignmentId={content} onComplete={onComplete} onCancel={onCancel} />
              ) : null}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

// MapReveal — smooths the map's size change between missions (300 <-> 150) WITHOUT
// animating the WebView's pixel height every frame (which forces the live map to
// repaint its canvas on each frame — janky on device). Instead we cross-fade: dim
// the map, commit the new height in a single step behind the dim (one repaint,
// unseen), then brighten back. Same visual result, smooth transition.
function MapReveal({ height, children }) {
  const [h, setH] = useState(height);          // committed height applied to layout
  const dim = useRef(new Animated.Value(1)).current;   // 1 = visible, 0.15 = dimmed during the swap
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (height === h) return;
    Animated.timing(dim, { toValue: 0.15, duration: M.fast, easing: Easing.out(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => {
        if (!finished) return;
        setH(height);   // single-step resize, hidden behind the dim
        Animated.timing(dim, { toValue: 1, duration: M.base, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      });
  }, [height, h, dim]);
  return (
    <Animated.View style={{ opacity: dim }}>
      {React.cloneElement(React.Children.only(children), { height: h })}
    </Animated.View>
  );
}

export function OperatorHome({ session, onOpenProfile }) {
  const [profile, setProfile] = useState(() => cacheGet('operator-profile'));   // instant paint, skips gate spinner
  const [loadFailed, setLoadFailed] = useState(false);  // profile load errored — show retry, not an endless spinner
  const [caps, setCaps] = useState(() => cacheGet('operator-caps') || []);
  const [jobs, setJobs] = useState(() => cacheGet('operator-jobs'));
  const [expandedBios, setExpandedBios] = useState({});  // job cards whose full duties/bio is expanded
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);   // which job/spot is acting (per-button spinner)
  const [msg, setMsg] = useState('');
  const [passed, setPassed] = useState(() => new Set());   // job item ids the worker passed on (session-local, soft)
  const [capPicker, setCapPicker] = useState(false);   // TradePicker for capabilities
  const [readiness, setReadiness] = useState({});      // trade_id -> { ready, missing[] }
  const [myLoc, setMyLoc] = useState(null);            // operator's own location for the map
  const [opMapJobs, setOpMapJobs] = useState([]);      // operator's assigned job sites
  const [demandHeat, setDemandHeat] = useState([]);    // where jobs are nearby — the "money map" heat (find-mode only)
  const [myAssigns, setMyAssigns] = useState([]);      // operator's own active assignments (for in-map lifecycle)
  const [dismissedDone, setDismissedDone] = useState([]);  // assignment ids whose "job done" moment the worker has dismissed → back to feed
  const [chat, setChat] = useState(null);              // { a, title, sub, info } — job room over the map
  const [arrivePrompt, setArrivePrompt] = useState(null);  // assignmentId awaiting on-site confirm (GPS override)
  const [closeOut, setCloseOut] = useState(null);           // assignmentId in the close-out gate (compliance)
  const [opMapExpanded, setOpMapExpanded] = useState(false);
  // Live location — follow the worker as they move (real GPS on Expo Go via
  // watchPositionAsync). Streams myLoc updates every ~4s / ~15m. Falls back once
  // to DEV_LOCATION when real GPS isn't available. stop() cleans up on unmount.
  useEffect(() => {
    let stop = null; let alive = true;
    watchPosition((p) => { if (alive) setMyLoc({ lat: p.lat, lng: p.lng }); })
      .then((fn) => { if (alive) { stop = fn; } else if (fn) { fn(); } });
    return () => { alive = false; if (stop) stop(); };
  }, []);
  useEffect(() => { (async () => { try { setOpMapJobs(await getOperatorMapJobs()); } catch (_) {} })(); }, [jobs]);
  useEffect(() => { (async () => { try { setMyAssigns(await listMyAssignments()); } catch (_) {} })(); }, [jobs]);

  // Demand heat ("where the work is") — the worker's money map. Fetched ONLY while finding work
  // (online, no active/on-site job) on a SLOW 90s timer: demand shifts over minutes not seconds, so
  // a lazy refresh gives the same value at a fraction of the DB cost. Stops entirely once working or
  // offline. NOTE: this hook lives ABOVE the early returns so it runs on every render (Rules of Hooks);
  // it guards on raw state (is_online + no active assignment) rather than the mission var, which is
  // computed lower down. myLoc is the live-tracked position.
  const _finding = !!(profile && profile.is_online) && !(myAssigns || []).some((a) => ['committed','accepted','en_route','on_site'].includes(a.status));
  useEffect(() => {
    if (!_finding || !myLoc) { setDemandHeat([]); return; }
    let alive = true;
    const pull = async () => {
      try { const d = await getDemandHeat(myLoc.lat, myLoc.lng, 40); if (alive) setDemandHeat(d || []); }
      catch (_) { /* heat is ambient — a miss just means no update this tick */ }
    };
    pull();
    const t = setInterval(pull, 90000); // 90s — demand trend, not live tracking
    return () => { alive = false; clearInterval(t); };
  }, [_finding, myLoc]);

  async function removeCap(id) {
    setBusy(true); setMsg('');
    try { await removeCapability(id); await refresh(); }
    catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }

  const refresh = useCallback(async () => {
    try {
      const p = await getMyProfile(); setProfile(p); cacheSet('operator-profile', p); setLoadFailed(false);
      const myCaps = await listMyCapabilities();
      setCaps(myCaps); cacheSet('operator-caps', myCaps);
      // readiness: mirrors the server accept-gate, so Home never lies about eligibility
      const tradeIds = myCaps.map((c) => c.trade_id).filter(Boolean);
      setReadiness(tradeIds.length ? await readinessForTrades(tradeIds) : {});
      const dispatches = p.is_online ? await listMyDispatches() : [];
      setJobs(dispatches); cacheSet('operator-jobs', dispatches);
    } catch (e) {
      setMsg(friendly(e));
      // never leave the screen stuck on a null spinner. If we never got a profile, flag the
      // failure so the UI shows a retry instead of hanging; otherwise resolve jobs to empty.
      setJobs((prev) => (prev === null ? [] : prev));
      setProfile((prev) => { if (prev === null) setLoadFailed(true); return prev; });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useRealtime(['dispatches', 'assignments'], refresh);

  async function becomeOperator() {
    setBusy(true); setMsg('');
    try { await setRole('operator'); await addCapability('crew', 'Traffic control', 'traffic_controller'); await setVehicle('ute'); await refresh(); }
    catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }
  async function toggleOnline() {
    setBusy(true); setMsg('');
    try {
      const goingOnline = !profile.is_online;
      await setOnline(goingOnline);
      if (goingOnline) {
        // capturing location is REQUIRED to receive jobs — dispatch is geographic.
        // If we can't get it, tell the operator instead of silently going online
        // with no location (which makes them invisible to the matcher).
        try {
          const pos = await getPosition();
          await setMyOperatorLocation(pos.lat, pos.lng);
        } catch (locErr) {
          setMsg('You\'re online, but we couldn\'t get your location — you won\'t receive jobs until location is on. Check location permissions and toggle again.');
        }
      }
      await refresh();
    } catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }
  async function accept(itemId) {
    setBusy(true); setBusyId(itemId); setMsg('');
    try { await acceptSpot(itemId); tap('success'); setMsg('✓ Spot accepted'); await refresh(); }
    catch (e) { setMsg('Accept failed: ' + friendly(e)); logError('accept', e, { correlationId: itemId, appContext: 'operator' }); } finally { setBusy(false); setBusyId(null); }
  }
  // Pass — soft, session-local. Tidies your list; job stays live for others.
  function pass(itemId) { setPassed((prev) => { const n = new Set(prev); n.add(itemId); return n; }); }
  // In-map lifecycle — SAME service calls as the Jobs tab, surfaced on the map.
  async function mapBeginJourney(id) {
    setBusy(true); setBusyId(id); setMsg('');
    try { let lat, lng; try { const pos = await getPosition(); lat = pos.lat; lng = pos.lng; } catch (_) {} await startJourney(id, lat, lng); await refresh(); }
    catch (e) { setMsg('Update failed: ' + friendly(e)); } finally { setBusy(false); setBusyId(null); }
  }
  async function mapArrive(id, override = false) {
    setBusy(true); setBusyId(id); setMsg('');
    try {
      const pos = await getPosition();
      await checkIn(id, pos.lat, pos.lng, override, override ? 'gps_override' : null);
      await refresh();
    } catch (e) {
      const m = (e && e.message) || '';
      // GPS says you're too far — offer to confirm you're actually on site
      if (!override && /too_far_from_site|too far|not.*site|distance|within/i.test(m)) {
        setBusy(false); setBusyId(null);
        setArrivePrompt(id);   // shows "Confirm you're on site" in the map
        return;
      }
      setMsg('Check-in failed: ' + friendly(e));
    } finally { setBusy(false); setBusyId(null); }
  }
  async function mapComplete(id) {
    setBusy(true); setBusyId(id); setMsg('');
    // GPS may be unavailable at checkout (indoors, permission, dead signal) — don't let that
    // block the worker from checking out and getting paid. Attempt a fix; proceed without it.
    // check_out records what coords it can; the C3 reconciliation path verifies hours otherwise.
    try {
      let lat = null, lng = null;
      try { const pos = await getPosition(); lat = pos.lat; lng = pos.lng; } catch (_) {}
      await checkOut(id, lat, lng, null); await refresh();
    }
    catch (e) { setMsg('Complete failed: ' + friendly(e)); logError('complete', e, { correlationId: id, appContext: 'operator' }); } finally { setBusy(false); setBusyId(null); }
  }
  // the next lifecycle action for one of my assignments
  function nextAction(a) {
    if (a.status === 'committed' || a.status === 'accepted') return { label: 'Start journey', fn: () => mapBeginJourney(a.id) };
    if (a.status === 'en_route') return { label: 'Arrived on site', fn: () => mapArrive(a.id) };
    if (a.status === 'on_site') return { label: 'Complete job', fn: () => setCloseOut(a.id) };
    return null;
  }
  async function addCapFromTrade(trade) {
    setCapPicker(false); setBusy(true); setMsg('');
    const legacyKind = trade.kind === 'plant' ? 'gear' : trade.kind;
    try { await addCapability(legacyKind, trade.name, trade.id); await refresh(); }
    catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }

  if (!profile) return (
    <Center>
      {loadFailed ? (
        <View style={{ alignItems: 'center', padding: 24 }}>
          <Text style={[T.body, { color: C.mute, textAlign: 'center', marginBottom: 16 }]}>Couldn't load your workspace.</Text>
          <TouchableOpacity onPress={() => { setLoadFailed(false); refresh(); }} style={S_.primary} activeOpacity={0.9}>
            <Text style={S_.primaryT}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ActivityIndicator color={C.indigo} />
      )}
    </Center>
  );

  if (capPicker) {
    return (
      <View style={[S_.fill, { padding: S.xl, paddingTop: 48 }]}>
        <Text style={[T.eyebrow, { marginBottom: 14 }]}>Add a capability</Text>
        <TradePicker onPick={addCapFromTrade} onCancel={() => setCapPicker(false)} />
      </View>
    );
  }

  if (profile.role !== 'operator') {
    return (
      <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }}>
        <Text style={T.eyebrow}>Start working</Text>
        <Text style={[T.body, { marginTop: 8, marginBottom: 18 }]}>Set yourself up to receive jobs — verified, online, and matched to work near you.</Text>
        <PrimaryBtn label="Set me up to work" onPress={becomeOperator} busy={busy} />
        {!!msg && <Text style={msg[0] === "✓" ? S_.successText : S_.msg}>{msg}</Text>}
      </ScrollView>
    );
  }

  // Mission state (Constitution Law 10 — one source of truth). The worker's current mission drives
  // the whole Work-home layout; compute it ONCE here and read it everywhere, never re-derive inline.
  const activeAssign = (myAssigns || []).find((a) => ['committed','accepted','en_route','on_site'].includes(a.status));
  const hasActiveJob = !!activeAssign;
  const onSite = activeAssign?.status === 'on_site';   // physically working — strip the UI to the essentials
  // a just-finished job the worker hasn't moved on from yet (complete = awaiting approval, approved = paid).
  // Only counts as the mission when: (a) no newer active job is taking over, (b) the worker hasn't
  // dismissed it, and (c) it finished RECENTLY. Without (b)+(c) any job ever completed would pin the
  // Home to the "done" screen forever and hide the marketplace — the feed must always come back.
  const DONE_WINDOW_MS = 30 * 60 * 1000; // a finished job is a "current" moment for 30 min, then it's history
  const doneAssign = !hasActiveJob
    ? (myAssigns || []).find((a) => {
        if (!['complete', 'approved'].includes(a.status)) return false;
        if (dismissedDone.includes(a.id)) return false;         // worker tapped "find more work"
        const finishedAt = a.paid_at || a.completed_at || a.accepted_at;
        if (!finishedAt) return false;
        return (Date.now() - new Date(finishedAt).getTime()) < DONE_WINDOW_MS;
      })
    : null;
  const freeAndOnline = profile.is_online && !hasActiveJob;
  // the single mission value everything reads:
  //   'working' — on site, actively doing the job → strip to Complete/Message (Laws 1, 8)
  //   'active'  — have a job but not yet on site → mission-control, feed recedes
  //   'done'    — just finished → confirm the outcome (paid / awaiting approval), then pivot to next (Law 13)
  //   'find'    — online + free → the marketplace leads
  //   'offline' — not online → jobs hidden
  const mission = onSite ? 'working'
    : hasActiveJob ? 'active'
    : doneAssign ? 'done'
    : profile.is_online ? 'find'
    : 'offline';

  return (
    <>
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      {(() => {
        // Map presence follows the mission: big when navigating/offline context, compact when the
        // mission is finding work or actively working (Laws 1+2 — don't let the map compete then).
        const mapHeight = (mission === 'find' || mission === 'working') ? 150 : 300;
        return (
      <MapReveal height={mapHeight}>
      <MapHero me={myLoc} markers={profile.is_online ? opMapJobs : []} mode="work" offline={!profile.is_online} dockedBottom demand={demandHeat}
        hubJobs={profile.is_online ? [
          // MY active jobs — with the next lifecycle step, done right on the map
          ...(myAssigns || []).filter((a) => ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status)).map((a) => {
            const na = nextAction(a);
            const words = { committed: 'Assigned — ready to start', accepted: 'Assigned — ready to start', en_route: "You're on the way", on_site: "You're on site" };
            return {
              id: `mine-${a.id}`, kind: 'mine', assignId: a.id,
              title: a.request_item?.type || 'Your job',
              sub: `${suburbOf(a.request_item?.request?.address_text)} · ${words[a.status] || ''}`,
              dotColor: a.status === 'on_site' ? C.green : a.status === 'en_route' ? C.indigo : C.mute,
              action: na ? na.label : null, _fn: na ? na.fn : null,
              detail: {
                rows: [
                  { k: 'Status', v: words[a.status] || a.status },
                  { k: 'Site', v: suburbOf(a.request_item?.request?.address_text) || '—' },
                  a.request_item?.rate ? { k: 'Rate', v: `$${a.request_item.rate}/hr` } : null,
                ].filter(Boolean),
                actions: [
                  na ? { label: na.label, tone: a.status === 'on_site' ? 'green' : 'ready', fn: na.fn } : null,
                  { label: 'Message client', tone: 'ghost', fn: () => setChat({ a, title: `${a.request_item?.type || 'Job'} · ${suburbOf(a.request_item?.request?.address_text) || ''}`, sub: 'Job room', info: buildJobInfo({ a, it: a.request_item, r: a.request_item?.request }) }) },
                ].filter(Boolean),
              },
            };
          }),
          // acceptable nearby jobs
          ...(jobs || []).filter((d) => !passed.has(d.request_item?.id)).map((d) => {
            const it = d.request_item; const r = it?.request;
            const qty = it?.qty || 1; const left = qty - (d.taken || 0); const mineHere = d.mine_accepted || 0;
            return {
              id: d.id, kind: 'accept', itemId: it?.id,
              title: it?.type || 'Job',
              sub: `${suburbOf(r?.address_text)} · ${left > 0 ? `${left} of ${qty} open` : 'Full'}${r?.when_type === 'now' ? ' · Urgent' : ''}`,
              dotColor: r?.when_type === 'now' ? C.amber : C.green,
              action: left <= 0 ? 'Full' : mineHere > 0 ? 'Take another' : 'Accept', _left: left,
              detail: {
                rows: [
                  { k: 'Type', v: it?.type || 'Job' },
                  { k: 'Site', v: suburbOf(r?.address_text) || '—' },
                  { k: 'Spots', v: left > 0 ? `${left} of ${qty} open` : 'Full' },
                  r?.when_type === 'now' ? { k: 'When', v: 'Urgent — now' } : { k: 'When', v: 'Booked' },
                  it?.rate ? { k: 'Rate', v: `$${it.rate}/hr` } : null,
                ].filter(Boolean),
                actions: [
                  left > 0 ? { label: mineHere > 0 ? 'Take another spot' : 'Accept this job', tone: 'green', fn: () => it?.id && accept(it.id) } : null,
                  { label: 'Pass', tone: 'ghost', fn: () => it?.id && pass(it.id) },
                ].filter(Boolean),
              },
            };
          }),
        ] : []}
        onHubAction={(j) => { if (j.kind === 'mine' && j._fn) j._fn(); else if (j.kind === 'accept' && j._left > 0 && j.itemId) accept(j.itemId); }}
        commandSummary={(() => {
          const activeMine = (myAssigns || []).filter((a) => ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status)).length;
          const near = (jobs || []).filter((d) => !passed.has(d.request_item?.id)).length;
          if (activeMine > 0) return `${activeMine} active${near ? ` · ${near} nearby` : ''}`;
          return near > 0 ? `${near} job${near > 1 ? 's' : ''} nearby` : 'No jobs nearby';
        })()}
        primaryAction={(() => {
          const mineActive = (myAssigns || []).filter((a) => ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status));
          if (mineActive.length > 0) { const a = mineActive[0]; const na = nextAction(a); if (na) return { label: na.label, sub: a.request_item?.type || 'Your job', tone: a.status === 'on_site' ? 'green' : 'ready', fn: na.fn, chevron: false }; }
          const near = (jobs || []).filter((d) => !passed.has(d.request_item?.id));
          if (near.length > 0) { const it = near[0].request_item; return { label: 'Accept nearest job', sub: it?.type || 'Work nearby', tone: 'green', fn: () => it?.id && accept(it.id), chevron: false }; }
          return null;
        })()}
        chatBubble={(() => {
          const mineActive = (myAssigns || []).filter((a) => ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status));
          if (mineActive.length === 0) return null;
          const a = mineActive[0];
          return { unread: 0, fn: () => setChat({ a, title: `${a.request_item?.type || 'Job'} · ${suburbOf(a.request_item?.request?.address_text) || ''}`, sub: 'Job room', info: buildJobInfo({ a, it: a.request_item, r: a.request_item?.request }) }) };
        })()}
      />
      </MapReveal>
        );
      })()}
      {/* Operator's live tracker — the SAME confidence experience, worker's lens. Closes the
          loop: the worker sees what they've done + that the client can see it. */}
      {(() => {
        const act = (myAssigns || []).find((a) => ['committed', 'accepted', 'en_route', 'on_site', 'complete'].includes(a.status));
        const rid = act?.request_item?.request?.id;
        if (!rid) return null;
        return <TrackerContainer requestId={rid} perspective="operator" onAction={(action) => {
          const aid = act?.id;
          if (action === 'open_chat') setChat({ a: act, title: `${act.request_item?.type || 'Job'} · ${suburbOf(act.request_item?.request?.address_text) || ''}`, sub: 'Job room', info: buildJobInfo({ a: act, it: act.request_item, r: act.request_item?.request }) });
          else if (action === 'start_journey' && aid) mapBeginJourney(aid);
          else if (action === 'arrive' && aid) mapArrive(aid);
          else if (action === 'complete' && aid) setCloseOut(aid);
        }} />;
      })()}
      {/* dock bar — mirrors Hire's "Post a job" bar, but holds the online toggle. When a live
          tracker card is showing above it, the dock becomes a separate rounded card with a gap
          (otherwise its flush-top design collides with the tracker). */}
      {(() => {
        const hasTracker = !!(myAssigns || []).find((a) => ['committed', 'accepted', 'en_route', 'on_site', 'complete'].includes(a.status))?.request_item?.request?.id;
        return (
      <TouchableOpacity style={[S_.askDock, hasTracker && S_.askDockStandalone]} onPress={toggleOnline} activeOpacity={0.92} disabled={busy}>
        <View style={{ flex: 1 }}>
          <Text style={S_.askDockLabel}>{profile.is_online ? 'YOU\'RE ONLINE' : 'YOU\'RE OFFLINE'}</Text>
          <Text style={S_.askDockT}>{profile.is_online ? 'Receiving jobs near you' : 'Go online to get work'}</Text>
        </View>
        <View style={[S_.sw, profile.is_online && S_.swOn]}>
          <View style={[S_.swKnob, profile.is_online && S_.swKnobOn]} />
        </View>
      </TouchableOpacity>
        );
      })()}
      <View style={{ padding: S.xl, paddingTop: 20 }}>

        <WorkFeed
          mission={mission}
          jobs={jobs}
          passed={passed}
          busyId={busyId}
          expandedBios={expandedBios}
          setExpandedBios={setExpandedBios}
          onAccept={accept}
          onPass={pass}
          onDismissDone={() => { if (doneAssign) setDismissedDone((prev) => [...prev, doneAssign.id]); }}
        />
        {!!msg && <Text style={msg[0] === "✓" ? S_.successText : S_.msg}>{msg}</Text>}

        {mission !== 'working' && (<>
        <Text style={[T.eyebrow, { marginTop: 26 }]}>What I supply</Text>
        <View style={{ marginTop: 10 }}>
          {caps.map((c) => {
            const r = c.trade_id ? readiness[c.trade_id] : null;
            return (
              <View key={c.id} style={S_.capRow}>
                <Icon name={c.kind === 'gear' ? 'gear' : c.kind === 'task' ? 'task' : 'crew'} size={17} color={C.ink} strokeWidth={1.9} />
                <View style={{ flex: 1 }}>
                  <Text style={T.bodyStrong}>{c.type}</Text>
                  {r && !r.ready && (
                    <Text style={[T.small, { color: C.amber, marginTop: 2 }]}>Needs: {r.missing.join(', ')}</Text>
                  )}
                </View>
                {r && (r.ready
                  ? <View style={S_.readyPill}><Text style={S_.readyText}>Ready ✓</Text></View>
                  : <View style={S_.notReadyPill}><Text style={S_.notReadyText}>Tickets needed</Text></View>
                )}
                <TouchableOpacity onPress={() => removeCap(c.id)} disabled={busy}>
                  <Text style={S_.rm}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          {caps.length === 0 && <Text style={[T.small, { color: C.mute, marginBottom: 4 }]}>Add what you supply to start getting matched to work nearby.</Text>}
        </View>
        <View style={S_.capAddRow}>
          <MiniBtn label="+ Add capability" onPress={() => setCapPicker(true)} />
        </View>

        <View style={{ marginTop: 22 }}><Pulse /></View>
        </>)}
      </View>
    </ScrollView>
    <JobChat
      visible={!!chat}
      onClose={() => { setChat(null); refresh(); }}
      assignmentId={chat?.a?.id}
      meId={session.user.id}
      title={chat?.title}
      subtitle={chat?.sub}
      jobInfo={chat?.info}
      peerId={chat?.a?.request_item?.request?.client_id}
      onOpenProfile={onOpenProfile}
    />
    <CloseOutSheet
      assignmentId={closeOut}
      onComplete={async () => { const id = closeOut; setCloseOut(null); await mapComplete(id); }}
      onCancel={() => setCloseOut(null)}
    />
    <Modal visible={!!arrivePrompt} transparent animationType="fade" onRequestClose={() => setArrivePrompt(null)}>
      <View style={S_.arriveScrim}>
        <View style={S_.arriveCard}>
          <Text style={S_.arriveTitle}>Confirm you're on site?</Text>
          <Text style={S_.arriveSub}>Your GPS shows you away from the job location. If you're actually on site, confirm to check in.</Text>
          <TouchableOpacity style={S_.arriveConfirm} activeOpacity={0.9} onPress={() => { const id = arrivePrompt; setArrivePrompt(null); mapArrive(id, true); }}>
            <Text style={S_.arriveConfirmT}>Yes, I'm on site</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setArrivePrompt(null)} style={{ paddingVertical: 10 }}>
            <Text style={S_.arriveCancel}>Not yet</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    </>
  );
}

/* ============================================================ OPERATOR · JOBS */
export function OperatorJobs({ session, onOpenProfile }) {
  const [assigns, setAssigns] = useState(() => cacheGet('operator-assignments'));   // shared cache → instant
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);   // which assignment is acting (per-button spinner)
  const [overrideFor, setOverrideFor] = useState(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);
  const [msg, setMsg] = useState('');
  const [unread, setUnread] = useState({});
  const [chat, setChat] = useState(null);   // { a, title, sub } — the open job room
  const [matClaim, setMatClaim] = useState(null);   // assignment for the materials claim sheet
  const [expandedBios, setExpandedBios] = useState({});   // which job cards have duties/brief expanded
  const refresh = useCallback(async () => {
    try { const d = await listMyAssignments(); setAssigns(d); cacheSet('operator-assignments', d); }
    catch { setAssigns((p) => (p == null ? [] : p)); }
    try { setUnread(await getUnreadCounts(session.user.id)); } catch (_) {}
  }, [session.user.id]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(async () => { try { setUnread(await getUnreadCounts(session.user.id)); } catch (_) {} }, 10000);
    return () => clearInterval(t);
  }, [session.user.id]);
  useRealtime(['assignments'], refresh);

  // Live location: while any of my jobs is en_route, ping my GPS every 15s so the
  // client sees me approaching. Sampled (not continuous), only while travelling.
  const enRouteKey = (assigns || []).filter((a) => a.status === 'en_route').map((a) => a.id).join(',');
  useEffect(() => {
    if (!enRouteKey) return;
    let alive = true;
    const ping = async () => {
      try {
        const pos = await getPosition();
        await Promise.all(enRouteKey.split(',').map((id) => updateMyLocation(id, pos.lat, pos.lng).catch(() => {})));
      } catch (_) { /* GPS unavailable this tick — client will show "last seen" */ }
    };
    ping();
    const t = setInterval(() => { if (alive) ping(); }, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [enRouteKey]);

  async function withdraw(id) {
    setBusy(true); setMsg('');
    try { await cancelAssignment(id); setConfirmWithdraw(null); await refresh(); setMsg('You have withdrawn from this job.'); }
    catch (e) { setMsg('Withdraw failed: ' + friendly(e)); } finally { setBusy(false); }
  }

  async function advance(id, to) { setBusy(true); setBusyId(id); setMsg(''); try { await advanceAssignment(id, to); await refresh(); } catch (e) { setMsg('Update failed: ' + friendly(e)); } finally { setBusy(false); setBusyId(null); } }

  // Explicit travel start (committed -> en_route). Captures the operator's real
  // position so the server computes an honest distance-based ETA. If GPS is
  // unavailable we still start — the client just sees no ETA rather than a fake one.
  async function beginJourney(id) {
    setBusy(true); setBusyId(id); setMsg('');
    try {
      let lat = null, lng = null;
      try { const pos = await getPosition(); lat = pos.lat; lng = pos.lng; } catch (_) { /* start without ETA */ }
      await startJourney(id, lat, lng);
      setMsg('You\u2019re on the way. The client\u2019s been notified.');
      await refresh();
    } catch (e) { setMsg('Couldn\u2019t start journey: ' + friendly(e)); logError('start_journey', e, { correlationId: id, appContext: 'operator' }); } finally { setBusy(false); setBusyId(null); }
  }

  // Geofenced arrival: capture GPS, call check_in; hard-block if too far.
  async function arrive(id, override = false) {
    setBusy(true); setBusyId(id); setMsg('');
    try {
      const pos = await getPosition();
      await checkIn(id, pos.lat, pos.lng, override, override ? 'gps_override' : null);
      if (pos.source === 'fallback') setMsg('Checked in (using approximate location — enable GPS for precise proof).');
      await refresh();
    } catch (e) {
      const raw = e?.message || '';
      if (raw.startsWith('too_far_from_site')) {
        const m = raw.split(':')[1];
        const dist = m ? Math.round(Number(m)) : null;
        setMsg(`You appear to be ${dist ? dist + 'm ' : ''}from the site (must be within 300m to check in). If your GPS is wrong, you can override.`);
        setOverrideFor(id);
      } else {
        setMsg('Check-in failed: ' + friendly(e));
      }
    } finally { setBusy(false); setBusyId(null); }
  }

  // Completion. GPS may be unavailable at checkout (indoors/no signal — routine on site);
  // check_out tolerates null coords (skips distance calc, still completes), so proceed without
  // a fix rather than blocking the worker from checking out and getting paid.
  async function complete(id) {
    setBusy(true); setBusyId(id); setMsg('');
    try {
      let lat = null, lng = null;
      try { const pos = await getPosition(); lat = pos.lat; lng = pos.lng; } catch (_) {}
      await checkOut(id, lat, lng, null);
      await refresh();
    } catch (e) { setMsg('Complete failed: ' + friendly(e)); logError('complete', e, { correlationId: id, appContext: 'operator' }); } finally { setBusy(false); setBusyId(null); }
  }

  // Phone died / GPS lost mid-shift: report finishing so the job enters reconciliation
  // (someone signs off, or it auto-settles on booked hours) rather than getting stuck on_site.
  async function missedCheckout(id) {
    setBusy(true); setBusyId(id); setMsg('');
    try {
      await reportMissedCheckout(id, new Date().toISOString());
      await refresh();
      setMsg('Reported. Your hours will be confirmed or auto-approved — you won\'t miss out on pay.');
    } catch (e) { setMsg('Couldn\'t report: ' + friendly(e)); } finally { setBusy(false); setBusyId(null); }
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }}>
      <Text style={T.eyebrow}>My jobs</Text>
      {assigns === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 12 }} />
        : assigns.length === 0 ? <Text style={[T.small, { marginTop: 8 }]}>No accepted jobs yet.</Text>
        : assigns.map((a) => {
          const committed = a.status === 'committed' || a.status === 'accepted';
          const next = committed ? ['en_route', 'Start journey']
            : a.status === 'en_route' ? ['on_site', 'Arrived on site']
            : a.status === 'on_site' ? ['complete', 'Mark complete'] : null;
          return (
            <View key={a.id} style={S_.card}>
              <View style={S_.rowBetween}>
                <Text style={T.heading}>{a.request_item?.type}</Text>
                <Text style={[T.label, { color: a.status === 'approved' ? C.green : next ? C.indigo : C.amber }]}>
                  {a.status === 'approved' ? 'Paid' : committed ? 'Committed' : a.status.replace('_', ' ')}
                </Text>
              </View>
              <Text style={[T.data, { color: C.mute, marginTop: 4 }]}>{a.request_item?.request?.address_text}</Text>

              {/* JOB BRIEF — what the worker accepted: pay, timing, client, materials, and the
                  duties the client wrote. Previously a worker committed with no way to re-read any
                  of this; now it's all here on the card. */}
              {(() => {
                const it = a.request_item; const r = it?.request;
                if (!r) return null;
                const rate = it.rate || it.rate_offered;
                const isJob = it.price_mode === 'job';
                const hrs = r.duration_hours || 4;
                const payLine = rate
                  ? (isJob ? `$${Number(rate).toLocaleString()} fixed for the job`
                           : `$${Number(rate).toLocaleString()}/hr · ~${hrs}h = ~$${Number(rate * hrs).toLocaleString()}`)
                  : null;
                const timeLine = r.when_type === 'scheduled' && r.scheduled_at
                  ? `Booked for ${new Date(r.scheduled_at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
                  : 'Now — as soon as you can get there';
                const bioOpen = expandedBios[a.id];
                return (
                  <View style={S_.briefBox}>
                    {payLine && (
                      <View style={S_.briefRow}>
                        <Text style={S_.briefK}>Pay</Text>
                        <Text style={S_.briefV}>{payLine}</Text>
                      </View>
                    )}
                    <View style={S_.briefRow}>
                      <Text style={S_.briefK}>When</Text>
                      <Text style={S_.briefV}>{timeLine}</Text>
                    </View>
                    {r.site_contact_name && (
                      <View style={S_.briefRow}>
                        <Text style={S_.briefK}>Site contact</Text>
                        <Text style={S_.briefV}>Ask for {r.site_contact_name} on site</Text>
                      </View>
                    )}
                    {r.materials_cap > 0 && (
                      <View style={S_.briefRow}>
                        <Text style={S_.briefK}>Materials</Text>
                        <Text style={S_.briefV}>Up to ${Number(r.materials_cap).toLocaleString()} reimbursed (keep receipts)</Text>
                      </View>
                    )}
                    {r.job_details ? (
                      <TouchableOpacity activeOpacity={0.7} onPress={() => setExpandedBios((m) => ({ ...m, [a.id]: !m[a.id] }))}>
                        <Text style={S_.briefK}>The job</Text>
                        <Text style={S_.briefBio} numberOfLines={bioOpen ? undefined : 3}>{r.job_details}</Text>
                        {r.job_details.length > 120 && <Text style={S_.briefMore}>{bioOpen ? 'show less' : 'show more'}</Text>}
                      </TouchableOpacity>
                    ) : (
                      <Text style={[S_.briefBio, { color: C.mute, fontStyle: 'italic' }]}>No extra details from the client. Message them if you need specifics.</Text>
                    )}
                  </View>
                );
              })()}
              {committed && <Text style={[T.small, { color: C.mute, marginTop: 6 }]}>You've secured this job. Start your journey when you're ready — the client will see you're on the way.</Text>}

              {/* the job room — direct line to the client while the job is live */}
              {['committed', 'accepted', 'en_route', 'on_site'].includes(a.status) && (
                <TouchableOpacity
                  style={S_.opMsgBtn}
                  onPress={() => setChat({
                    a,
                    title: `Job room · ${a.request_item?.type || 'Job'}`,
                    sub: suburbOf(a.request_item?.request?.address_text),
                    info: buildJobInfo({ a, it: a.request_item, r: a.request_item?.request }),
                  })}
                  activeOpacity={0.8}
                >
                  <Text style={S_.opMsgT}>Message the client</Text>
                  {(unread[a.id] || 0) > 0 && <View style={S_.matchBadge}><Text style={S_.matchBadgeT}>{unread[a.id]}</Text></View>}
                </TouchableOpacity>
              )}
              {/* materials claim — available once on site, for jobs with a budget (or any job; server gates) */}
              {['en_route', 'on_site'].includes(a.status) && (
                <TouchableOpacity style={S_.opMatBtn} onPress={() => setMatClaim(a)} activeOpacity={0.8}>
                  <Text style={S_.opMatT}>+ Add materials{a.request_item?.request?.materials_cap > 0 ? ` (budget $${a.request_item.request.materials_cap})` : ''}</Text>
                </TouchableOpacity>
              )}
              <View style={{ height: 12 }} />
              {next
                ? (next[0] === 'on_site'
                    ? <PrimaryBtn label="Arrived on site" onPress={() => arrive(a.id)} busy={busyId === a.id} />
                    : next[0] === 'complete'
                      ? (a.reconcile_state === 'needs_reconciliation'
                          ? <View style={S_.opAwaitWrap}>
                              <Text style={[T.data, { color: C.amber }]}>Hours pending confirmation</Text>
                              {(() => {
                                const left = a.reconcile_deadline ? autoReleaseIn(a.reconcile_deadline) : null;
                                if (!left) return null;
                                return <Text style={[T.small, { color: C.mute, marginTop: 3 }]}>
                                  {left.passed ? 'Auto-confirming your booked hours now.' : `If nobody confirms, your booked hours auto-approve in ${left.text}. You won't miss out.`}
                                </Text>;
                              })()}
                            </View>
                          : <>
                              <PrimaryBtn label="Mark complete" onPress={() => complete(a.id)} busy={busyId === a.id} />
                              <TouchableOpacity onPress={() => missedCheckout(a.id)} disabled={busy} style={{ marginTop: 10, alignItems: 'center' }}>
                                <Text style={[T.small, { color: C.mute, textDecorationLine: 'underline' }]}>Can't check out? Phone died or no signal</Text>
                              </TouchableOpacity>
                            </>)
                      : <PrimaryBtn label={next[1]} onPress={() => beginJourney(a.id)} busy={busyId === a.id} />)
                : a.status === 'approved'
                  ? <View style={S_.opPaidWrap}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={S_.opPaidCheck}><Text style={S_.opPaidCheckT}>✓</Text></View>
                        <Text style={[T.bodyStrong, { color: C.green, flex: 1 }]}>Approved &amp; paid</Text>
                        <Text style={[T.money, { color: C.green }]}>${Number(a.net_amount || 0).toLocaleString()}</Text>
                      </View>
                    </View>
                  : <View style={S_.opAwaitWrap}>
                      <Text style={[T.data, { color: C.amber }]}>✓ Complete — awaiting client approval</Text>
                      {(() => {
                        const dl = a.request_item?.request?.review_deadline;
                        const left = dl ? autoReleaseIn(dl) : null;
                        if (!left) return null;
                        return <Text style={[T.small, { color: C.mute, marginTop: 3 }]}>
                          {left.passed ? "You'll be paid shortly — auto-releasing now." : `You'll be paid automatically in ${left.text} if the client doesn't respond.`}
                        </Text>;
                      })()}
                    </View>}
              {overrideFor === a.id && a.status === 'en_route' && (
                <TouchableOpacity onPress={() => { setOverrideFor(null); arrive(a.id, true); }} disabled={busy} style={{ marginTop: 10 }}>
                  <Text style={[T.data, { color: C.amber, textDecorationLine: 'underline' }]}>My GPS is wrong — check in anyway (flagged)</Text>
                </TouchableOpacity>
              )}

              {/* withdraw / abort — before completion only */}
              {a.status !== 'complete' && a.status !== 'approved' && a.status !== 'cancelled' && (
                confirmWithdraw === a.id ? (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <Text style={[T.small, { color: C.amber }]}>
                      {a.status === 'on_site' ? 'Abort this job? This is logged and the client is notified.' : 'Withdraw from this job? Your spot re-opens for others.'}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[S_.dangerBtn, { flex: 1 }]} onPress={() => withdraw(a.id)} disabled={busy}>
                        <Text style={S_.dangerBtnT}>{a.status === 'on_site' ? 'Abort job' : 'Withdraw'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[S_.ghostBtn, { flex: 1 }]} onPress={() => setConfirmWithdraw(null)} disabled={busy}>
                        <Text style={S_.ghostBtnT}>Stay on job</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setConfirmWithdraw(a.id)} style={{ marginTop: 10 }} disabled={busy}>
                    <Text style={[T.data, { color: C.mute, textDecorationLine: 'underline' }]}>
                      {a.status === 'on_site' ? 'Abort job' : 'Can\u2019t make it? Withdraw'}
                    </Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          );
        })}
      {!!msg && <Text style={msg[0] === "✓" ? S_.successText : S_.msg}>{msg}</Text>}
    </ScrollView>
    <JobChat
      visible={!!chat}
      onClose={() => { setChat(null); refresh(); }}
      assignmentId={chat?.a?.id}
      meId={session.user.id}
      title={chat?.title}
      subtitle={chat?.sub}
      jobInfo={chat?.info}
      peerId={chat?.a?.request_item?.request?.client_id}
      onOpenProfile={onOpenProfile}
    />
    <MaterialsClaim
      visible={!!matClaim}
      assignment={matClaim}
      onClose={() => setMatClaim(null)}
      onDone={() => { setMsg('Materials claim submitted.'); refresh(); }}
    />
    </View>
  );
}

/* ============================================================ OPERATOR · EARNINGS */
export function OperatorEarnings({ session }) {
  const [assigns, setAssigns] = useState(() => cacheGet('operator-assignments'));   // instant paint
  const refresh = useCallback(async () => {
    try { const d = await listMyAssignments(); setAssigns(d); cacheSet('operator-assignments', d); }
    catch { setAssigns((p) => (p == null ? [] : p)); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useRealtime(['assignments'], refresh);

  const paid = (assigns || []).filter((a) => a.status === 'approved');
  const pending = (assigns || []).filter((a) => a.status === 'complete');
  const totalPaid = paid.reduce((n, a) => n + (Number(a.net_amount) || 0), 0);
  const pendingValue = pending.reduce((n, a) => n + (Number(a.net_amount) || 0), 0);

  return (
    <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }}>
      <Text style={T.eyebrow}>Earnings</Text>
      <View style={[S_.card, { marginTop: 12, alignItems: 'center', paddingVertical: 26 }]}>
        <Text style={T.label}>Paid to you</Text>
        <Text style={[T.dataBig, { fontSize: 38, color: C.green, marginTop: 6 }]}>${totalPaid.toLocaleString()}</Text>
        <Text style={[T.small, { marginTop: 2 }]}>{paid.length} job{paid.length !== 1 ? 's' : ''} settled · net after 12% fee</Text>
      </View>

      {pending.length > 0 && (
        <View style={[S_.card, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={[T.label, { color: C.amber }]}>Awaiting approval</Text>
            <Text style={[T.small, { marginTop: 2 }]}>{pending.length} job{pending.length !== 1 ? 's' : ''} complete, not yet settled</Text>
          </View>
          <Text style={[T.money, { color: C.amber }]}>${pendingValue.toLocaleString()}</Text>
        </View>
      )}

      <Text style={[T.eyebrow, { marginTop: 8 }]}>History</Text>
      {assigns === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 12 }} />
        : paid.length === 0 ? <Text style={[T.small, { marginTop: 8 }]}>No settled jobs yet. Finish a job and get it approved to see earnings here.</Text>
        : paid.map((a) => (
          <View key={a.id} style={S_.card}>
            <View style={S_.rowBetween}>
              <Text style={T.heading}>{a.request_item?.type}</Text>
              <Text style={T.money}>${Number(a.net_amount || 0).toLocaleString()}</Text>
            </View>
            <View style={S_.rowBetween}>
              <Text style={[T.data, { color: C.mute, marginTop: 4, flex: 1 }]} numberOfLines={1}>{suburbOf(a.request_item?.request?.address_text)}</Text>
              <Text style={[T.label, { fontSize: 9, marginTop: 4, marginLeft: 8 }]}>{a.paid_at ? new Date(a.paid_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}</Text>
            </View>
          </View>
        ))}
    </ScrollView>
  );
}

/* ============================================================ ACCOUNT (both roles) */
export function Account({ session, role, onNameSaved, onOpenProfile }) {
  const [screen, setScreen] = useState(null);   // null | 'credentials'
  const [comingSoon, setComingSoon] = useState(null);  // label of a not-yet-built feature the user tapped
  const [name, setName] = useState(() => cacheGet('profile-name') || '');
  const [savedName, setSavedName] = useState(() => cacheGet('profile-name'));   // instant paint — no email→name flicker
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');

  useEffect(() => {
    (async () => {
      try { const p = await getMyProfile(); if (p.full_name) { setSavedName(p.full_name); setName(p.full_name); cacheSet('profile-name', p.full_name); } } catch (_) {}
    })();
  }, []);

  async function saveName() {
    if (!name.trim() || saving) return;
    setSaving(true); setNameMsg('');
    try {
      const n = await updateMyName(name);
      setSavedName(n); setEditing(false); cacheSet('profile-name', n);   // keep cache in sync with the new name
      onNameSaved && onNameSaved();
    } catch (e) { setNameMsg('Could not save name.'); }
    finally { setSaving(false); }
  }

  if (screen === 'credentials') {
    return <CredentialsScreen onClose={() => setScreen(null)} />;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }}>
      <Text style={T.eyebrow}>Account</Text>
      <View style={[S_.card, { marginTop: 12 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={S_.avatar}><Icon name={role === 'operator' ? 'crew' : 'account'} size={24} color={C.indigo} /></View>
          <View style={{ flex: 1 }}>
            <Text style={T.heading}>{savedName || session.user.email.split('@')[0]}</Text>
            <Text style={[T.label, { fontSize: 10, marginTop: 2 }]}>{session.user.email}</Text>
          </View>
          {!editing && (
            <TouchableOpacity onPress={() => setEditing(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[T.data, { color: C.indigo }]}>{savedName ? 'Edit' : 'Add name'}</Text>
            </TouchableOpacity>
          )}
        </View>
        {editing && (
          <View style={{ marginTop: 14 }}>
            <Text style={[T.label, { marginBottom: 6 }]}>Your name — shown to people you work with</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={S_.nameInput}
                placeholder="e.g. Michael Santi"
                placeholderTextColor={C.mute2}
                value={name}
                onChangeText={setName}
                maxLength={80}
                autoFocus
              />
              <TouchableOpacity style={[S_.nameSave, !name.trim() && { opacity: 0.4 }]} onPress={saveName} disabled={!name.trim() || saving}>
                <Text style={S_.nameSaveT}>{saving ? '…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
            {!!nameMsg && <Text style={[T.small, { color: C.red, marginTop: 6 }]}>{nameMsg}</Text>}
          </View>
        )}
        <TouchableOpacity style={S_.viewProfileBtn} onPress={() => onOpenProfile && onOpenProfile(session.user.id)} activeOpacity={0.85}>
          <Icon name="account" size={16} color={C.indigo} />
          <Text style={S_.viewProfileT}>View my public profile</Text>
        </TouchableOpacity>
      </View>

      <AccountSection title="Profile" rows={role === 'operator'
        ? [['verified', 'Tickets & expiry', 'Manage', () => setScreen('credentials')], ['insurance', 'Insurance', 'Soon', () => setComingSoon('Insurance')], ['gear', 'Capabilities & rig', 'Soon', () => setComingSoon('Capabilities & rig')], ['pin', 'Service radius', 'Soon', () => setComingSoon('Service radius')]]
        : [['company', 'Company & ABN', 'Add', () => setComingSoon('Company & ABN')], ['pin', 'Saved sites', 'Soon', () => setComingSoon('Saved sites')], ['payment', 'Payment methods', 'Soon', () => setComingSoon('Payment methods')]]} />

      <AccountSection title={role === 'operator' ? 'Payouts' : 'Business'} rows={role === 'operator'
        ? [['payment', 'Bank details', 'Soon', () => setComingSoon('Bank details')], ['earnings', 'Payout speed', 'Soon', () => setComingSoon('Payout speed')], ['activity', 'Tax summary', 'Soon', () => setComingSoon('Tax summary')]]
        : [['users', 'Team seats', 'Soon', () => setComingSoon('Team seats')], ['payment', 'Monthly billing', 'Soon', () => setComingSoon('Monthly billing')], ['trending', 'Spend reporting', 'Soon', () => setComingSoon('Spend reporting')]]} />

      <AccountSection title="Settings" rows={[['bell', 'Notifications', 'Soon', () => setComingSoon('Notifications')], ['insurance', 'Verified network', 'Active', () => setComingSoon('Verified network')], ['settings', 'Help & support', '', () => setComingSoon('Help & support')]]} />

      <TouchableOpacity style={S_.signoutBtn} onPress={async () => { cacheClearAll(); await unregisterPush(); supabase.auth.signOut(); }}>
        <Text style={S_.signoutText}>Sign out</Text>
      </TouchableOpacity>

      {/* Coming-soon sheet — every roadmap row opens this instead of doing nothing, named for the
          feature tapped, so nothing in the account section is a dead button. */}
      <Modal visible={!!comingSoon} transparent animationType="fade" onRequestClose={() => setComingSoon(null)}>
        <TouchableOpacity style={S_.csScrim} activeOpacity={1} onPress={() => setComingSoon(null)}>
          <TouchableOpacity style={S_.csSheet} activeOpacity={1} onPress={() => {}}>
            <View style={S_.csGrip} />
            <View style={S_.csIcon}><Icon name="settings" size={22} color={C.indigo} /></View>
            <Text style={S_.csTitle}>{comingSoon}</Text>
            <Text style={S_.csBody}>This is on the way. It isn't part of this early build yet — we're focused on getting the core hire-and-work flow right first.</Text>
            <TouchableOpacity style={S_.csBtn} onPress={() => setComingSoon(null)} activeOpacity={0.9}>
              <Text style={S_.csBtnT}>Got it</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

/* ============================================================ SHARED COMPONENTS */
