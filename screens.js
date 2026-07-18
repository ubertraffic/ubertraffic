// screens.js — Operator screens extracted from App.js (paste-size fix).
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Animated, Easing, Modal, KeyboardAvoidingView, Platform, SafeAreaView, StatusBar, Keyboard, Dimensions, StyleSheet, Pressable } from 'react-native';
import { C, R, S, E, M, T, Z } from './theme';
import { SH, S_ } from './styles';
import Icon, { iconForType } from './Icon';
import { supabase } from './supabaseClient';
import MapHero from './MapHero';
import GoOnlineOrb from './GoOnlineOrb';
import EndShiftSheet from './EndShiftSheet';
import LiveTrackerCard from './LiveTrackerCard';
import Pulse from './Pulse';
import JobChat from './JobChat';
import { jobTitle, jobSubtitle, estTotal, RateCard, WorkFeed, AvailableJobCard, TaskPriceCard, MiniReqCard, statusMeta, OperatorCard, StageTracker, FullReqCard, AccountSection, RoleChip, QuickTile, AddBtn, AddressField, MiniBtn, SegBtn, LiveTag, PrimaryBtn, tap, Center } from './components2';
import { friendly, suburbOf, MatchCard, EmptyState, workerLine, repLine, requestHasStall, isStalledAssignment, autoReleaseIn, MaterialsClaim, VouchCrewCard, RateJob } from './components';
import CredentialsScreen from './CredentialsScreen';
import BusinessDetailsScreen from './BusinessDetailsScreen';
import AdminScreen from './AdminScreen';
import VehiclesScreen from './VehiclesScreen';
import PayoutsScreen from './PayoutsScreen';
import { amIAdmin } from './adminService';
import TradePicker from './TradePicker';
import { getTrackerState, advanceAssignment, cancelAssignment, checkIn, checkOut, getOperatorMapJobs, reportMissedCheckout, startJourney, updateMyLocation } from './completionService';
import CloseOutCard from './CloseOutCard';
import PrestartCard from './PrestartCard';
import RunCloseOutCard from './RunCloseOutCard';
import RunBrief from './RunBrief';
import AcceptCelebration from './AcceptCelebration';
import HelpCenter from './HelpCenter';
import SkillDiscoverySheet from './SkillDiscoverySheet';
import { complianceReady } from './complianceService';

// A run = a task whose trade carries a run_style (set in migration 0045). The open
// "what to get" list lives in job_details; the spend cap in materials_cap.
function isRunAssignment(a) { return !!(a && a.request_item && a.request_item.trade && a.request_item.trade.run_style); }
function runInfoFor(a) {
  const r = a.request_item?.request;
  return { id: a.id, list: r?.job_details || '', cap: r?.materials_cap || 0, pickup: r?.pickup_text || '', drop: r?.address_text || '', a };
}

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
import { setMyIdentity } from './accountService';
import { formatDMY, dmyToISO } from './dateFormat';
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
  const [kb, setKb] = useState(0);        // keyboard height, so the sheet lifts above it
  const a = useRef(new Animated.Value(0)).current;         // 0 = hidden (below screen), 1 = shown
  useEffect(() => {
    if (assignmentId) {
      // Slide up from a FIXED off-screen offset — the SAME clean motion as PrestartSheet. The old
      // measure-first opacity gate ("measure then reveal") was the twitch; a bottom-anchored sheet
      // parked at a big translateY springs to rest with no mid-slide re-adjust or flash.
      setContent(assignmentId);
      setMounted(true);
      a.setValue(0);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, ...M.spring }).start();
    } else if (mounted) {
      Animated.timing(a, { toValue: 0, duration: M.fast, easing: Easing.in(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
    // `mounted` intentionally omitted: this reacts to assignmentId open/close only.
  }, [assignmentId, a]);
  // Track the keyboard so the sheet can rise above it (the sign-off name field).
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); hd.remove(); };
  }, []);
  if (!mounted) return null;
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [900, 0] });
  const backdrop = a.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: kb }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdrop }} />
        <Animated.View
          pointerEvents={assignmentId ? 'auto' : 'none'}
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

// usePrestartStatus — tracks, per on-site assignment, whether a safety prestart is
// still REQUIRED-AND-MISSING. Read-only: it asks the existing compliance_ready gate
// (which already reflects the trade's needs_prestart flag) and records whether
// 'prestart' is in its missing list. Errand-tier trades never list it, so they're
// simply never gated. `needs[id] === true` means "must do the prestart first".
function usePrestartStatus(assigns) {
  const [needs, setNeeds] = useState({});   // { [assignmentId]: true|false }
  // Ask the server for one assignment; returns true if prestart is required-and-missing.
  const check = useCallback(async (id) => {
    try {
      const g = await complianceReady(id);
      const req = (((g && g.missing) || []).includes('prestart'));
      setNeeds((p) => ({ ...p, [id]: req }));
      return req;
    } catch (_) { return null; }   // unknown → leave ungated (server still backstops completion)
  }, []);
  // Optimistic: once a prestart is submitted we know it's no longer required.
  const markDone = useCallback((id) => setNeeds((p) => ({ ...p, [id]: false })), []);
  // Keep the map fresh for whatever jobs are currently on-site (covers app restart
  // mid-shift). Keyed on the on-site id set so it only re-runs when that changes.
  const onSiteKey = (assigns || []).filter((a) => a.status === 'on_site').map((a) => a.id).join(',');
  useEffect(() => { (onSiteKey ? onSiteKey.split(',') : []).forEach(check); }, [onSiteKey, check]);
  return { needs, check, markDone };
}

// PrestartSheet — the arrival safety prestart in the same bottom-sheet host as
// CloseOutSheet (safe-area + smooth native slide). Deliberately mirrors CloseOutSheet
// rather than refactoring it (kept separate to avoid touching the close-out path;
// the two can be unified into one sheet host later).
function PrestartSheet({ assignmentId, onDone, onCancel }) {
  const [mounted, setMounted] = useState(!!assignmentId);
  const [content, setContent] = useState(assignmentId);   // held through exit
  const [kb, setKb] = useState(0);        // keyboard height, so the sheet lifts above it
  const a = useRef(new Animated.Value(0)).current;         // 0 = hidden (below screen), 1 = shown
  useEffect(() => {
    if (assignmentId) {
      // Slide up from a FIXED off-screen offset (no measure-first opacity gate — that one-frame
      // "measure then reveal" step was the glitch). The sheet is bottom-anchored, so starting at
      // a big translateY simply parks it below the screen, then it springs cleanly to rest.
      setContent(assignmentId);
      setMounted(true);
      a.setValue(0);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, ...M.spring }).start();
    } else if (mounted) {
      Animated.timing(a, { toValue: 0, duration: M.fast, easing: Easing.in(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
    // reacts to assignmentId open/close only
  }, [assignmentId, a]);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); hd.remove(); };
  }, []);
  if (!mounted) return null;
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [900, 0] });
  const backdrop = a.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: kb }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdrop }} />
        <Animated.View
          pointerEvents={assignmentId ? 'auto' : 'none'}
          style={{ maxHeight: '100%', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0, transform: [{ translateY }] }}
        >
          <SafeAreaView>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: S.md }}
              showsVerticalScrollIndicator={false}
            >
              {content ? (
                <PrestartCard assignmentId={content} onDone={onDone} onCancel={onCancel} />
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
// repaint its canvas on each frame — janky on device). Instead: fade a plain cover
// INSIDE the map frame up to fully opaque, commit the new height in a single step
// behind it (one repaint, hidden), then fade the cover back out. We never animate
// the WebView's own opacity — that blinks on Android. Same visual result, no flicker.
function MapReveal({ height, children }) {
  const [h, setH] = useState(height);          // committed height applied to layout
  const mask = useRef(new Animated.Value(0)).current;   // 0 = map clear, 1 = fully covered
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (height === h) return;
    Animated.timing(mask, { toValue: 1, duration: M.fast, easing: Easing.out(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => {
        if (!finished) return;
        setH(height);   // single-step resize, hidden behind the cover
        Animated.timing(mask, { toValue: 0, duration: M.base, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
      });
  }, [height, h, mask]);
  return React.cloneElement(React.Children.only(children), { height: h, maskOpacity: mask });
}

// BottomSheet — generic measure-first slide-up sheet (same motion as CloseOutSheet,
// extracted so runs don't need a third copy). `activeKey` truthy opens it and is held
// through the exit so the card stays rendered while it leaves; render(held) draws the
// card. Lifts above the keyboard. CloseOutSheet/PrestartSheet can migrate onto this
// later — kept separate now to avoid touching the labour flow.
function BottomSheet({ activeKey, onRequestClose, render }) {
  const [mounted, setMounted] = useState(!!activeKey);
  const [held, setHeld] = useState(activeKey);
  const [h, setH] = useState(0);
  const [kb, setKb] = useState(0);
  const a = useRef(new Animated.Value(0)).current;
  const waiting = useRef(false);
  useEffect(() => {
    if (activeKey) { setHeld(activeKey); setMounted(true); a.setValue(0); setH(0); waiting.current = true; }
    else if (mounted) {
      Animated.timing(a, { toValue: 0, duration: M.fast, easing: Easing.in(Easing.quad), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [activeKey, a]);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKb(e.endCoordinates?.height || 0));
    const hd = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); hd.remove(); };
  }, []);
  if (!mounted) return null;
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [h || 1000, 0] });
  const backdrop = a.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });
  const onMeasured = (e) => {
    const nh = e.nativeEvent.layout.height;
    if (!nh) return;
    if (Math.abs(nh - h) > 1) setH(nh);
    if (waiting.current) { waiting.current = false; Animated.spring(a, { toValue: 1, useNativeDriver: true, ...M.spring }).start(); }
  };
  return (
    <Modal visible transparent animationType="none" onRequestClose={onRequestClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingBottom: kb }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: backdrop }} />
        <Animated.View
          pointerEvents={activeKey ? 'auto' : 'none'}
          onLayout={onMeasured}
          style={{ maxHeight: '100%', paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0, opacity: h > 0 ? 1 : 0, transform: [{ translateY }] }}
        >
          <SafeAreaView>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: S.md }} showsVerticalScrollIndicator={false}>
              {held ? render(held) : null}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function OperatorHome({ session, onOpenProfile, onScroll }) {
  const [profile, setProfile] = useState(() => cacheGet('operator-profile'));   // instant paint, skips gate spinner
  const [loadFailed, setLoadFailed] = useState(false);  // profile load errored — show retry, not an endless spinner
  const [caps, setCaps] = useState(() => cacheGet('operator-caps') || []);
  const [jobs, setJobs] = useState(() => cacheGet('operator-jobs'));
  const [expandedBios, setExpandedBios] = useState({});  // job cards whose full duties/bio is expanded
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);   // which job/spot is acting (per-button spinner)
  const [celebrate, setCelebrate] = useState(null);   // "it's a match" payload after a successful accept
  const [helpOpen, setHelpOpen] = useState(false);    // Help centre sheet
  const [discSkill, setDiscSkill] = useState(null);   // skill tapped in "What I supply" → discovery sheet
  const [msg, setMsg] = useState('');
  const [passed, setPassed] = useState(() => new Set());   // job item ids the worker passed on (session-local, soft)
  const [capPicker, setCapPicker] = useState(false);   // TradePicker for capabilities
  const [capsOpen, setCapsOpen] = useState(false);     // "What I supply" expanded to the full editor (collapsed by default — the home stays calm)
  const [idName, setIdName] = useState('');            // onboarding identity: full legal name
  const [idDob, setIdDob] = useState('');              // onboarding identity: date of birth (entered DD/MM/YYYY, stored ISO)
  const [readiness, setReadiness] = useState({});      // trade_id -> { ready, missing[] }
  const [myLoc, setMyLoc] = useState(null);            // operator's own location for the map
  const [opMapJobs, setOpMapJobs] = useState([]);      // operator's assigned job sites
  const [demandHeat, setDemandHeat] = useState([]);    // where jobs are nearby — the "money map" heat (find-mode only)
  const [myAssigns, setMyAssigns] = useState([]);      // operator's own active assignments (for in-map lifecycle)
  const [dismissedDone, setDismissedDone] = useState([]);  // assignment ids whose "job done" moment the worker has dismissed → back to feed
  const [chat, setChat] = useState(null);              // { a, title, sub, info } — job room over the map
  const [arrivePrompt, setArrivePrompt] = useState(null);  // assignmentId awaiting on-site confirm (GPS override)
  const [closeOut, setCloseOut] = useState(null);           // assignmentId in the close-out gate (compliance)
  const [runOut, setRunOut] = useState(null);               // { id, list, cap, a } for the run close-out
  const [prestart, setPrestart] = useState(null);           // assignmentId in the arrival safety-prestart gate
  const { needs: prestartNeeds, check: checkPrestart, markDone: markPrestartDone } = usePrestartStatus(myAssigns);
  const [opMapExpanded, setOpMapExpanded] = useState(false);
  const flood = useRef(new Animated.Value(0)).current;   // green colour-flood when going online
  const [onlineSince, setOnlineSince] = useState(null);  // when this shift started (for the live timer)
  const [endShift, setEndShift] = useState(false);       // "Nice work" end-of-shift sheet visible
  const [ratePrompt, setRatePrompt] = useState(null);    // { assignmentId } — rate the CLIENT after payout
  const ratePromptedRef = useRef(new Set());             // assignment ids already prompted this session
  const rateSeededRef = useRef(false);                   // seed existing-approved so we only prompt on NEW payouts
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
  // shift clock — starts when the worker goes online (kept if already online on load), clears offline.
  useEffect(() => {
    if (profile?.is_online) setOnlineSince((s) => s || Date.now());
    else setOnlineSince(null);
  }, [profile?.is_online]);
  // Rate the CLIENT after a job is approved+paid. Seed existing-approved on first load so we only
  // prompt when a job flips to approved DURING this session (not for old history on every open).
  useEffect(() => {
    if (!myAssigns) return;
    const approved = myAssigns.filter((a) => a.status === 'approved');
    if (!rateSeededRef.current) { approved.forEach((a) => ratePromptedRef.current.add(a.id)); rateSeededRef.current = true; return; }
    const fresh = approved.find((a) => !ratePromptedRef.current.has(a.id));
    if (fresh && !ratePrompt) { ratePromptedRef.current.add(fresh.id); setRatePrompt({ assignmentId: fresh.id }); }
  }, [myAssigns]);

  async function becomeOperator() {
    // Capture identity first — the anchor a register check needs (Phase 2). Validated in setMyIdentity.
    const name = (idName || '').trim();
    if (name.length < 2) { setMsg('Enter your full legal name.'); return; }
    const iso = dmyToISO(idDob);
    if (!iso) { setMsg('Enter your date of birth as DD/MM/YYYY.'); return; }
    setBusy(true); setMsg('');
    try { await setMyIdentity(name, iso); await setRole('operator'); await addCapability('crew', 'Traffic control', 'traffic_controller'); await setVehicle('ute'); await refresh(); }
    catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }
  async function toggleOnline() {
    setBusy(true); setMsg('');
    try {
      const goingOnline = !profile.is_online;
      await setOnline(goingOnline);
      if (goingOnline) {
        // capturing location is REQUIRED to receive jobs — dispatch is geographic. getPosition()
        // never throws; it returns source:'fallback' when GPS is denied/unavailable, so we must
        // check that explicitly (a real device with location off must NOT be pinned to dev coords).
        try {
          const pos = await getPosition();
          if (pos.source === 'fallback') {
            await setOnline(false);   // roll back — don't sit online invisible/mis-located
            setMsg('Turn on location to go online — SiteCall matches you to jobs near where you are. Enable location access, then try again.');
            return;
          }
          await setMyOperatorLocation(pos.lat, pos.lng);
        } catch (locErr) {
          await setOnline(false);
          setMsg('Couldn\'t get your location, so you\'re not online yet. Check location permissions and try again.');
          return;
        }
      }
      await refresh();
    } catch (e) { setMsg(friendly(e)); } finally { setBusy(false); }
  }
  // Going online with the payoff — a green colour-flood blooms from the orb as the map ignites.
  async function goLive() {
    flood.setValue(0);
    Animated.timing(flood, { toValue: 1, duration: 640, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => flood.setValue(0));
    await toggleOnline();
  }
  async function accept(itemId) {
    setBusy(true); setBusyId(itemId); setMsg('');
    // capture the job's details BEFORE refresh clears the feed, for the celebration
    const d = (jobs || []).find((x) => x.request_item?.id === itemId);
    const it = d?.request_item; const r = it?.request;
    try {
      await acceptSpot(itemId); tap('success');
      // the accept-lock has already succeeded server-side — THIS is just the celebration
      setCelebrate({ type: it?.type, rate: it?.rate, suburb: suburbOf(r?.address_text), urgent: r?.when_type === 'now' });
      await refresh();
    }
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
      // Arrival safety gate: if this trade requires a prestart, open it now — before
      // the job is workable. Errand-tier trades return false and go straight through.
      if (await checkPrestart(id)) setPrestart(id);
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
    // capture details for the "job done" celebration before refresh clears them
    const doneA = (myAssigns || []).find((x) => x.id === id);
    const doneIt = doneA?.request_item;
    try {
      let lat = null, lng = null;
      try { const pos = await getPosition(); lat = pos.lat; lng = pos.lng; } catch (_) {}
      await checkOut(id, lat, lng, null);
      tap('success');
      setCelebrate({ variant: 'complete', type: doneIt?.type, suburb: suburbOf(doneIt?.request?.address_text) });
      await refresh();
    }
    catch (e) { setMsg('Complete failed: ' + friendly(e)); logError('complete', e, { correlationId: id, appContext: 'operator' }); } finally { setBusy(false); setBusyId(null); }
  }
  // the next lifecycle action for one of my assignments
  function nextAction(a) {
    if (a.status === 'committed' || a.status === 'accepted') return { label: 'Start journey', fn: () => mapBeginJourney(a.id) };
    if (a.status === 'en_route') return { label: 'Arrived on site', fn: () => mapArrive(a.id) };
    // On site: if a prestart is still required-and-missing, that's the next action;
    // only once it's done does "Complete job" (the close-out gate) become available.
    if (a.status === 'on_site') return prestartNeeds[a.id] === true
      ? { label: 'Safety prestart', fn: () => setPrestart(a.id) }
      : isRunAssignment(a)
      ? { label: 'Complete run', fn: () => setRunOut(runInfoFor(a)) }
      : { label: 'Complete job', fn: () => setCloseOut(a.id) };
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
      <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 116 }}>
        <Text style={T.eyebrow}>Start working</Text>
        <Text style={[T.body, { marginTop: 8, marginBottom: 18 }]}>Set yourself up to receive jobs — verified, online, and matched to work near you.</Text>
        <Text style={[T.label, { marginBottom: 6 }]}>Full legal name</Text>
        <TextInput style={S_.input} value={idName} onChangeText={setIdName} placeholder="As it appears on your licence / White Card" placeholderTextColor={C.mute2} />
        <Text style={[T.label, { marginBottom: 6, marginTop: 12 }]}>Date of birth</Text>
        <TextInput style={S_.input} value={idDob} onChangeText={(t) => setIdDob(formatDMY(t))} placeholder="DD/MM/YYYY" placeholderTextColor={C.mute2} keyboardType="number-pad" />
        <Text style={[T.small, { color: C.mute, marginTop: 8, marginBottom: 18 }]}>Used only to check your tickets and licences against the registers — never shown publicly.</Text>
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
  // The immersive green Work home (full-bleed map + floating sheet + GO orb) covers the "deciding /
  // available" states. Once a job is active/working/done we keep the proven mission-control layout
  // below so none of the on-site + close-out flows change.
  const immersive = mission === 'offline' || mission === 'find';
  // Earnings anchor — REAL settled pay (same source of truth as the Earnings tab: net_amount on
  // approved assignments). Today = settled in the last 24h, This week = last 7 days.
  const opEarn = (() => {
    const paid = (myAssigns || []).filter((a) => a.status === 'approved');
    const now = Date.now(), DAY = 86400000;
    let today = 0, week = 0;
    paid.forEach((a) => {
      const v = Number(a.net_amount) || 0;
      const t = new Date(a.paid_at || a.completed_at || 0).getTime();
      if (now - t < DAY) today += v;
      if (now - t < 7 * DAY) week += v;
    });
    return { today: Math.round(today), week: Math.round(week) };
  })();

  return (
    <>
    {immersive ? (
      <View style={{ flex: 1 }}>
        {/* full-bleed green work map — ambient decision context */}
        <View style={StyleSheet.absoluteFill}>
          <MapHero
            height={Dimensions.get('window').height} framed={false} mode="work" me={myLoc}
            offline={!profile.is_online} demand={demandHeat} markers={profile.is_online ? opMapJobs : []}
            hubJobs={profile.is_online ? (jobs || []).filter((d) => !passed.has(d.request_item?.id)).map((d) => {
              const it = d.request_item; const r = it?.request; const qty = it?.qty || 1; const left = qty - (d.taken || 0);
              return {
                id: d.id, kind: 'accept', itemId: it?.id,
                title: it?.type || 'Job', sub: `${suburbOf(r?.address_text)} · ${left > 0 ? `${left} of ${qty} open` : 'Full'}${r?.when_type === 'now' ? ' · Urgent' : ''}`,
                dotColor: r?.when_type === 'now' ? C.amber : C.green, action: left <= 0 ? 'Full' : 'Accept', _left: left,
                detail: { rows: [{ k: 'Type', v: it?.type || 'Job' }, { k: 'Site', v: suburbOf(r?.address_text) || '—' }, { k: 'Spots', v: left > 0 ? `${left} of ${qty} open` : 'Full' }, it?.rate ? { k: 'Rate', v: `$${it.rate}/hr` } : null].filter(Boolean),
                  actions: [left > 0 ? { label: 'Accept this job', tone: 'green', fn: () => it?.id && accept(it.id) } : null, { label: 'Pass', tone: 'ghost', fn: () => it?.id && pass(it.id) }].filter(Boolean) },
              };
            }) : []}
            onHubAction={(j) => { if (j.kind === 'accept' && j._left > 0 && j.itemId) accept(j.itemId); }}
            commandSummary={(() => { const near = (jobs || []).filter((d) => !passed.has(d.request_item?.id)).length; return profile.is_online ? (near > 0 ? `${near} job${near > 1 ? 's' : ''} nearby` : 'Finding work near you') : 'Go online to get work'; })()}
          />
        </View>
        {/* GREEN COLOUR-FLOOD — blooms up from the orb as you go online */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: '44%', left: '50%', marginLeft: -65, marginTop: -65, width: 130, height: 130, borderRadius: 65, backgroundColor: C.green, opacity: flood.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.85, 0] }), transform: [{ scale: flood.interpolate({ inputRange: [0, 1], outputRange: [0.2, 18] }) }] }} />
        {/* floating green sheet — dashboard-forward for the worker; the orb crowns it */}
        <View style={{ position: 'absolute', left: 0, right: 0, top: '40%', bottom: 0, backgroundColor: C.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 26, shadowOffset: { width: 0, height: -10 }, elevation: 14 }}>
          {/* control PINNED above the scroll — orb centres itself; the online pill stretches wide.
              Pinning it (not inside the scroll) keeps a press-and-hold from being stolen by scrolling. */}
          <View style={{ paddingTop: 20, paddingBottom: 12, paddingHorizontal: 16 }}>
            <GoOnlineOrb online={profile.is_online} busy={busy} onConfirm={goLive} onGoOffline={() => setEndShift(true)} earningsToday={opEarn.today} onlineSince={onlineSince} />
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
            {/* earnings — the worker's emotional anchor (wired to real totals in a later pass) */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1, backgroundColor: C.panel, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase' }}>Today</Text>
                <Text style={{ fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5, marginTop: 4 }}>${opEarn.today}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: C.panel, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase' }}>This week</Text>
                <Text style={{ fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5, marginTop: 4 }}>${opEarn.week}</Text>
              </View>
            </View>
            {/* demand line — where the work is right now (offline only; WorkFeed carries the online header) */}
            {!profile.is_online && (
              <>
                <View style={[S_.rowBetween, { marginBottom: 10 }]}>
                  <Text style={T.eyebrow}>Demand near you</Text>
                  <LiveTag />
                </View>
                <Text style={{ fontSize: 13.5, color: C.mute, fontWeight: '600', marginBottom: 14, lineHeight: 19 }}>
                  Labour is in demand across Sydney right now — go online to see jobs near you and start earning.
                </Text>
              </>
            )}
            <WorkFeed mission={mission} jobs={jobs} passed={passed} busyId={busyId} expandedBios={expandedBios} setExpandedBios={setExpandedBios} onAccept={accept} onPass={pass} onDismissDone={() => {}} />
            {!!msg && <Text style={msg[0] === '✓' ? S_.successText : S_.msg}>{msg}</Text>}
            {/* what I supply — with readiness, so a worker who gets no jobs learns WHY (tickets) */}
            {(() => {
              const readyCaps = caps.filter((c) => c.trade_id && readiness[c.trade_id]?.ready);
              const notReady = caps.filter((c) => c.trade_id && readiness[c.trade_id] && !readiness[c.trade_id].ready);
              const noneReady = caps.length > 0 && readyCaps.length === 0;
              return (
                <>
                  {profile.is_online && noneReady && (
                    <TouchableOpacity onPress={() => setCapPicker(true)} activeOpacity={0.9}
                      style={{ backgroundColor: 'rgba(214,158,46,0.12)', borderRadius: 14, padding: 14, marginTop: 16, borderWidth: 1, borderColor: 'rgba(214,158,46,0.30)' }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: C.amber }}>No jobs coming through? Add your tickets</Text>
                      <Text style={{ fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 3, lineHeight: 18 }}>Your skills need verified tickets (e.g. White Card) before sites can be matched to you.</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[S_.capSummary, { marginTop: 16 }]} onPress={() => setCapPicker(true)} activeOpacity={0.85}>
                    <View style={{ flex: 1 }}>
                      <Text style={T.bodyStrong}>{caps.length === 0 ? 'Add what you supply' : `${caps.length} skill${caps.length === 1 ? '' : 's'}${readyCaps.length > 0 ? ` · ${readyCaps.length} ready` : ''}`}</Text>
                      <Text style={[T.small, { color: notReady.length > 0 ? C.amber : C.mute, marginTop: 4 }]}>
                        {caps.length === 0 ? 'Get matched to work nearby.' : notReady.length > 0 ? `${notReady.length} need tickets before you're matched` : 'Tap to add another skill.'}
                      </Text>
                    </View>
                    <Text style={S_.capChevron}>›</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </ScrollView>
        </View>
      </View>
    ) : (
    <Animated.ScrollView onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 128 }}>
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
        return <TrackerContainer requestId={rid} perspective="operator" onAction={(action, arg) => {
          const aid = act?.id;
          if (action === 'open_chat') setChat({ a: act, title: `${act.request_item?.type || 'Job'} · ${suburbOf(act.request_item?.request?.address_text) || ''}`, sub: 'Job room', info: buildJobInfo({ a: act, it: act.request_item, r: act.request_item?.request }) });
          else if (action === 'start_journey' && aid) mapBeginJourney(aid);
          else if (action === 'arrive' && aid) mapArrive(aid);
          else if (action === 'complete' && aid) { if (prestartNeeds[aid] === true) setPrestart(aid); else if (isRunAssignment(act)) setRunOut(runInfoFor(act)); else setCloseOut(aid); }
          else if (action === 'open_help') setHelpOpen(true);
          else if (action === 'open_profile' && arg && onOpenProfile) onOpenProfile(arg);
        }} />;
      })()}
      {/* dock bar — mirrors Hire's "Post a job" bar, but holds the online toggle. When a live
          tracker card is showing above it, the dock becomes a separate rounded card with a gap
          (otherwise its flush-top design collides with the tracker). */}
      {(() => {
        const hasTracker = !!(myAssigns || []).find((a) => ['committed', 'accepted', 'en_route', 'on_site', 'complete'].includes(a.status))?.request_item?.request?.id;
        return (
      <TouchableOpacity style={[S_.askDock, hasTracker && S_.askDockStandalone, profile.is_online && S_.askDockQuiet]} onPress={toggleOnline} activeOpacity={0.92} disabled={busy}>
        <View style={{ flex: 1 }}>
          <Text style={[S_.askDockLabel, profile.is_online && S_.askDockLabelQuiet]}>{profile.is_online ? 'YOU\'RE ONLINE' : 'YOU\'RE OFFLINE'}</Text>
          <Text style={[S_.askDockT, profile.is_online ? S_.askDockTQuiet : S_.askDockTLg]}>{profile.is_online ? 'Receiving jobs near you' : 'Go online to get work'}</Text>
        </View>
        <View style={[S_.sw, profile.is_online && S_.swOn]}>
          <View style={[S_.swKnob, profile.is_online && S_.swKnobOn]} />
        </View>
      </TouchableOpacity>
        );
      })()}
      <View style={{ padding: 24, paddingTop: 24 }}>

        {/* Run brief — the moment a worker has an active run, show what/where/cap/drop + the
            "message before you buy" CTA up front, so the details aren't buried in the finish sheet. */}
        {(() => {
          const runA = (myAssigns || []).find((a) => isRunAssignment(a) && ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status));
          if (!runA) return null;
          const info = runInfoFor(runA);
          return <RunBrief list={info.list} pickup={info.pickup} cap={info.cap} drop={info.drop}
            onMessage={() => setChat({ a: runA, title: `${runA.request_item?.type || 'Run'} · ${suburbOf(runA.request_item?.request?.address_text) || ''}`, sub: 'Job room', info: buildJobInfo({ a: runA, it: runA.request_item, r: runA.request_item?.request }) })} />;
        })()}

        {/* offline first-impression — the display hero this screen was missing, pointing at the
            loud "Go online" toggle above. WorkFeed still shows its quiet "jobs near you" note below. */}
        {mission === 'offline' && (
          <View style={{ marginBottom: 8 }}>
            <Text style={S_.homeEmptyHero}>Ready to earn?</Text>
            <Text style={S_.homeEmptySub}>Flip the switch above — jobs near you show up the moment you're online.</Text>
          </View>
        )}

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

        {/* just finished a job with others on it? offer to vouch for the crew (self-hides if solo) */}
        {mission === 'done' && doneAssign?.request_item?.request?.id && (
          <VouchCrewCard requestId={doneAssign.request_item.request.id} />
        )}

        {mission !== 'working' && (() => {
          // A capability is a "skill" once it's actually dispatchable (credential gate passed).
          // Collapsed by default so the home stays calm; tap to open the full add/remove editor.
          const readyCaps = caps.filter((c) => c.trade_id && readiness[c.trade_id]?.ready);
          return (<>
          <Text style={[T.eyebrow, { marginTop: 24 }]}>What I supply</Text>
          {!capsOpen ? (
            <TouchableOpacity style={S_.capSummary} onPress={() => setCapsOpen(true)} activeOpacity={0.85}>
              <View style={{ flex: 1 }}>
                <Text style={T.bodyStrong}>
                  {caps.length === 0 ? 'Nothing yet' : `${caps.length} skill${caps.length === 1 ? '' : 's'}`}
                  {readyCaps.length > 0 ? ` · ${readyCaps.length} ready` : ''}
                </Text>
                {caps.length === 0 ? (
                  <Text style={[T.small, { color: C.mute, marginTop: 4 }]}>Add what you supply to start getting matched to work nearby.</Text>
                ) : (
                  <View style={S_.capTagWrap}>
                    {readyCaps.slice(0, 4).map((c) => (
                      <View key={c.id} style={S_.capTag}><Text style={S_.capTagT}>{c.type}</Text></View>
                    ))}
                    {caps.length - Math.min(readyCaps.length, 4) > 0 && (
                      <View style={S_.capTagMuted}><Text style={S_.capTagMutedT}>+{caps.length - Math.min(readyCaps.length, 4)} more</Text></View>
                    )}
                  </View>
                )}
              </View>
              <Text style={S_.capChevron}>›</Text>
            </TouchableOpacity>
          ) : (<>
          {caps.length > 0 && <Text style={[T.small, { color: C.mute, marginTop: 8, marginBottom: 2 }]}>Tap a skill to see others who do it.</Text>}
          <View style={{ marginTop: 8 }}>
            {caps.map((c) => {
              const r = c.trade_id ? readiness[c.trade_id] : null;
              return (
                <View key={c.id} style={S_.capRow}>
                  <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} activeOpacity={0.7} onPress={() => setDiscSkill(c.type)}>
                    <Icon name={c.kind === 'gear' ? 'gear' : c.kind === 'task' ? 'task' : 'crew'} size={17} color={C.ink} strokeWidth={1.9} />
                    <View style={{ flex: 1 }}>
                      <Text style={T.bodyStrong}>{c.type}</Text>
                      {r && !r.ready
                        ? <Text style={[T.small, { color: C.amber, marginTop: 2 }]}>Needs: {r.missing.join(', ')}</Text>
                        : <Text style={[T.small, { color: C.mute2, marginTop: 2 }]}>See others ›</Text>}
                    </View>
                  </TouchableOpacity>
                  {r && (r.ready
                    ? <View style={S_.readyPill}><Text style={S_.readyText}>Ready ✓</Text></View>
                    : <View style={S_.notReadyPill}><Text style={S_.notReadyText}>Tickets needed</Text></View>
                  )}
                  <TouchableOpacity onPress={() => removeCap(c.id)} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={S_.rm}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {caps.length === 0 && <Text style={[T.small, { color: C.mute, marginBottom: 4 }]}>Add what you supply to start getting matched to work nearby.</Text>}
          </View>
          <View style={S_.capAddRow}>
            <MiniBtn label="+ Add capability" onPress={() => setCapPicker(true)} />
            <MiniBtn label="Done" onPress={() => setCapsOpen(false)} />
          </View>
          </>)}

          <View style={{ marginTop: 24 }}><Pulse /></View>
          </>);
        })()}
      </View>
    </Animated.ScrollView>
    )}
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
    <AcceptCelebration data={celebrate} onDone={() => setCelebrate(null)} />
    <EndShiftSheet
      visible={endShift}
      onClose={() => setEndShift(false)}
      onConfirmOffline={() => { setEndShift(false); toggleOnline(); }}
      summary={{
        today: opEarn.today,
        jobs: (myAssigns || []).filter((a) => ['complete', 'approved'].includes(a.status) && (Date.now() - new Date(a.paid_at || a.completed_at || a.accepted_at || 0).getTime()) < 86400000).length,
        minutes: onlineSince ? Math.max(0, Math.floor((Date.now() - onlineSince) / 60000)) : 0,
        pending: (myAssigns || []).filter((a) => a.status === 'complete').length,   // done, not yet approved → why "earned" can read $0
      }}
    />
    <RateJob
      visible={!!ratePrompt}
      assignmentId={ratePrompt?.assignmentId}
      rateeName="the client"
      rateeIsWorker={false}
      onClose={() => setRatePrompt(null)}
    />
    <HelpCenter visible={helpOpen} onClose={() => setHelpOpen(false)} role="operator" />
    <SkillDiscoverySheet skill={discSkill} excludeUserId={session.user.id} onClose={() => setDiscSkill(null)} onOpenProfile={onOpenProfile} />
    <CloseOutSheet
      assignmentId={closeOut}
      onComplete={async () => { const id = closeOut; setCloseOut(null); await mapComplete(id); }}
      onCancel={() => setCloseOut(null)}
    />
    <PrestartSheet
      assignmentId={prestart}
      onDone={() => { const id = prestart; setPrestart(null); markPrestartDone(id); }}
      onCancel={() => setPrestart(null)}
    />
    <BottomSheet
      activeKey={runOut}
      onRequestClose={() => setRunOut(null)}
      render={(run) => (
        <RunCloseOutCard
          assignmentId={run.id}
          list={run.list}
          cap={run.cap}
          pickup={run.pickup}
          onComplete={async () => { const id = run.id; setRunOut(null); await mapComplete(id); }}
          onCancel={() => setRunOut(null)}
          onMessage={() => setChat({ a: run.a, title: `${run.a.request_item?.type || 'Run'} · ${suburbOf(run.a.request_item?.request?.address_text) || ''}`, sub: 'Job room', info: buildJobInfo({ a: run.a, it: run.a.request_item, r: run.a.request_item?.request }) })}
        />
      )}
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
  const [closeOut, setCloseOut] = useState(null);   // assignmentId in the close-out gate (compliance) — same gate as OperatorHome
  const [runOut, setRunOut] = useState(null);       // { id, list, cap, a } for the run close-out
  const [prestart, setPrestart] = useState(null);   // assignmentId in the arrival safety-prestart gate — same gate as OperatorHome
  const { needs: prestartNeeds, check: checkPrestart, markDone: markPrestartDone } = usePrestartStatus(assigns);
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
      // Arrival safety gate: open the prestart now if this trade requires one.
      // Errand-tier trades return false and go straight through.
      if (await checkPrestart(id)) setPrestart(id);
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
    <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 116 }}>
      <Text style={T.eyebrow}>My jobs</Text>
      {assigns === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 12 }} />
        : assigns.length === 0 ? <Text style={[T.small, { marginTop: 8 }]}>No accepted jobs yet.</Text>
        : assigns.map((a) => {
          const committed = a.status === 'committed' || a.status === 'accepted';
          const next = committed ? ['en_route', 'Start journey']
            : a.status === 'en_route' ? ['on_site', 'Arrived on site']
            : a.status === 'on_site' ? ['complete', 'Mark complete'] : null;
          const st = a.status === 'approved' ? { label: 'Paid', color: C.green }
            : a.status === 'complete' ? { label: 'Awaiting approval', color: C.amber }
            : a.status === 'cancelled' ? { label: 'Cancelled', color: C.red }
            : a.status === 'on_site' ? { label: 'On site', color: C.green }
            : a.status === 'en_route' ? { label: 'On the way', color: C.indigo }
            : { label: 'Committed', color: C.mute };
          return (
            <View key={a.id} style={S_.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={[T.heading, { flex: 1 }]} numberOfLines={1}>{a.request_item?.type}</Text>
                <View style={{ backgroundColor: st.color + '1A', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
                  <Text style={{ color: st.color, fontWeight: '800', fontSize: 11.5, letterSpacing: 0.2 }}>{st.label}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                <Icon name="pin" size={13} color={C.mute2} strokeWidth={2} />
                <Text style={[T.data, { color: C.mute, flex: 1 }]} numberOfLines={1}>{a.request_item?.request?.address_text}</Text>
              </View>

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
                        <Text style={[S_.briefV, { color: C.green, fontWeight: '800' }]}>{payLine}</Text>
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

              {/* runs: "check before you buy" is the loudest thing while a run is live —
                  buying the wrong thing is the #1 failure mode of an open run */}
              {isRunAssignment(a) && ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status) && (
                <TouchableOpacity
                  onPress={() => setChat({ a, title: `Job room · ${a.request_item?.type || 'Run'}`, sub: suburbOf(a.request_item?.request?.address_text), info: buildJobInfo({ a, it: a.request_item, r: a.request_item?.request }) })}
                  activeOpacity={0.9}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14, marginTop: 12 }}
                >
                  <Text style={{ fontSize: 16 }}>{'💬'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14.5 }}>Not sure what's wanted?</Text>
                    <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 1 }}>Message the client before you buy</Text>
                  </View>
                  {(unread[a.id] || 0) > 0 && <View style={S_.matchBadge}><Text style={S_.matchBadgeT}>{unread[a.id]}</Text></View>}
                </TouchableOpacity>
              )}
              {/* the job room — direct line to the client while the job is live */}
              {!isRunAssignment(a) && ['committed', 'accepted', 'en_route', 'on_site'].includes(a.status) && (
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
                              {prestartNeeds[a.id] === true
                                ? <PrimaryBtn label="Safety prestart" onPress={() => setPrestart(a.id)} busy={busyId === a.id} />
                                : isRunAssignment(a)
                                ? <PrimaryBtn label="Complete run" onPress={() => setRunOut(runInfoFor(a))} busy={busyId === a.id} />
                                : <PrimaryBtn label="Mark complete" onPress={() => setCloseOut(a.id)} busy={busyId === a.id} />}
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
    <CloseOutSheet
      assignmentId={closeOut}
      onComplete={async () => { const id = closeOut; setCloseOut(null); await complete(id); }}
      onCancel={() => setCloseOut(null)}
    />
    <PrestartSheet
      assignmentId={prestart}
      onDone={() => { const id = prestart; setPrestart(null); markPrestartDone(id); }}
      onCancel={() => setPrestart(null)}
    />
    <BottomSheet
      activeKey={runOut}
      onRequestClose={() => setRunOut(null)}
      render={(run) => (
        <RunCloseOutCard
          assignmentId={run.id}
          list={run.list}
          cap={run.cap}
          pickup={run.pickup}
          onComplete={async () => { const id = run.id; setRunOut(null); await complete(id); }}
          onCancel={() => setRunOut(null)}
          onMessage={() => setChat({ a: run.a, title: `Job room · ${run.a.request_item?.type || 'Run'}`, sub: suburbOf(run.a.request_item?.request?.address_text), info: buildJobInfo({ a: run.a, it: run.a.request_item, r: run.a.request_item?.request }) })}
        />
      )}
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
    <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 116 }}>
      <Text style={T.eyebrow}>Earnings</Text>
      <View style={[S_.card, { marginTop: 12, alignItems: 'center', paddingVertical: 26 }]}>
        <Text style={T.label}>Paid to you</Text>
        <Text style={[T.dataBig, { fontSize: 38, color: C.green, marginTop: 6 }]}>${totalPaid.toLocaleString()}</Text>
        <Text style={[T.small, { marginTop: 2 }]}>{paid.length} job{paid.length !== 1 ? 's' : ''} settled · net after fees</Text>
        <Text style={[T.tiny, { marginTop: 6, color: C.mute2, textAlign: 'center', paddingHorizontal: 12 }]}>SiteCall keeps 10% of labour + $3 per task. Tips & travel are 100% yours.</Text>
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
  const [screen, setScreen] = useState(null);   // null | 'credentials' | 'business'
  const [comingSoon, setComingSoon] = useState(null);  // label of a not-yet-built feature the user tapped
  const [name, setName] = useState(() => cacheGet('profile-name') || '');
  const [savedName, setSavedName] = useState(() => cacheGet('profile-name'));   // instant paint — no email→name flicker
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);   // server-checked; the panel only appears for admins
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try { const p = await getMyProfile(); if (p.full_name) { setSavedName(p.full_name); setName(p.full_name); cacheSet('profile-name', p.full_name); } } catch (_) {}
    })();
    (async () => { try { setIsAdmin(await amIAdmin()); } catch (_) {} })();
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
  if (screen === 'business') {
    return <BusinessDetailsScreen onClose={() => setScreen(null)} />;
  }
  if (screen === 'admin') {
    return <AdminScreen onClose={() => setScreen(null)} />;
  }
  if (screen === 'rig') {
    return <VehiclesScreen onClose={() => setScreen(null)} />;
  }
  if (screen === 'payouts') {
    return <PayoutsScreen onClose={() => setScreen(null)} />;
  }

  return (
    <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 116 }}>
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

      {isAdmin && (
        <TouchableOpacity style={S_.adminCard} onPress={() => setScreen('admin')} activeOpacity={0.9}>
          <View style={S_.adminIcon}><Icon name="settings" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={S_.adminTitle}>Admin panel</Text>
            <Text style={S_.adminSub}>Reviews · ABNs · users · ops</Text>
          </View>
          <Text style={S_.adminChev}>›</Text>
        </TouchableOpacity>
      )}

      <AccountSection title="Profile" rows={role === 'operator'
        ? [['verified', 'Tickets & expiry', 'Manage', () => setScreen('credentials')], ['gear', 'Vehicles & rego', 'Manage', () => setScreen('rig')], ['pin', 'Service radius', 'Soon', () => setComingSoon('Service radius')]]
        : [['company', 'Company & ABN', 'Manage', () => setScreen('business')], ['gear', 'Vehicles & plant', 'Manage', () => setScreen('rig')], ['pin', 'Saved sites', 'Soon', () => setComingSoon('Saved sites')], ['payment', 'Payment methods', 'Soon', () => setComingSoon('Payment methods')]]} />

      <AccountSection title={role === 'operator' ? 'Payouts' : 'Business'} rows={role === 'operator'
        ? [['payment', 'Payouts & bank', 'Set up', () => setScreen('payouts')], ['earnings', 'Payout speed', 'Soon', () => setComingSoon('Payout speed')], ['activity', 'Tax summary', 'Soon', () => setComingSoon('Tax summary')]]
        : [['users', 'Team seats', 'Soon', () => setComingSoon('Team seats')], ['payment', 'Monthly billing', 'Soon', () => setComingSoon('Monthly billing')], ['trending', 'Spend reporting', 'Soon', () => setComingSoon('Spend reporting')]]} />

      <AccountSection title="Settings" rows={[['bell', 'Notifications', 'Soon', () => setComingSoon('Notifications')], ['insurance', 'Verified network', 'Soon', () => setComingSoon('Verified network')], ['settings', 'Help & support', '', () => setHelpOpen(true)]]} />

      <HelpCenter visible={helpOpen} onClose={() => setHelpOpen(false)} role={role === 'operator' ? 'operator' : 'client'} />

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
