import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar, PanResponder,
  Animated, Dimensions, Pressable, Keyboard, Modal, Easing, Linking, RefreshControl, FlatList,
} from 'react-native';
import { supabase } from './supabaseClient';
import PayJobSheet from './PayJobSheet';
import { createRequest, listMyRequests } from './requestsService';
import { submitRating, myRatingForAssignment } from './ratingsService';
import { searchAddress, reverseGeocode } from './geocodeService';
import { loadTaxonomy, tradesInCategory, FRONT_DOORS, tradesForDoor, groupedTradesForDoor, clientPickerGroups, featuredTrades, pickerFolders, searchTrades, tradeTitle } from './taxonomyService';
import {
  setRole, setOnline, setVehicle, getMyProfile, updateMyName,
  setMyOperatorLocation, getOperatorCoverage, getDemandHeat,
  addCapability, listMyCapabilities, removeCapability,
  listMyDispatches, acceptSpot, listMyAssignments,
} from './operatorService';
import { submitCredential, submitBusinessAbn, setMyIdentity } from './accountService';
import { formatDMY, dmyToISO } from './dateFormat';
import { getUnreadCounts } from './messagesService';
import { cacheGet, cacheSet, cacheBindUser, cacheClearAll, cacheHydrate } from './screenCache';
import JobChat from './JobChat';
import { Entrance, PressableScale, AnimatedBar, useCountUp, CrossFade, useAttentionBump } from './Motion';
import { advanceAssignment, checkIn, checkOut, approveRequest, cancelRequest, cancelAssignment, repostRequest, startJourney, getMapJobs, getOperatorMapJobs, updateMyLocation, listMyRequestsFull, reportMissedCheckout, submitMaterialClaim, listMaterialClaims, resolveMaterialClaim, getTrackerState } from './completionService';
import { getPosition } from './location';
import { useRealtime } from './useRealtime';
import LiveTrackerCard from './LiveTrackerCard';
import PublicProfile from './PublicProfile';
import { registerForPush, unregisterPush, addPushTapListener } from './pushService';
import MapHero from './MapHero';
import HelpCenter from './HelpCenter';
import SearchingScreen from './SearchingScreen';
import ProofPhotoTest from './ProofPhotoTest';
import TradePicker from './TradePicker';
import CredentialsScreen from './CredentialsScreen';
import { readinessForTrades, verifiedCredentialsFor, requiredTicketsForTrades } from './credentialsService';
import Icon, { iconForType } from './Icon';
import TabBar from './TabBar';
import RoleToggle from './RoleToggle';
import Pulse from './Pulse';
import { getPulseStats } from './pulseService';
import MomentToasts from './MomentToast';
import { C, MONO, S, R, T, E, M, Z, shadow, shadowSm } from './theme';
import { SH, S_ } from './styles';
import { OperatorHome, OperatorJobs, OperatorEarnings, Account } from './screens';
import { RateCard, WorkFeed, AvailableJobCard, TaskPriceCard, MiniReqCard, statusMeta, OperatorCard, StageTracker, FullReqCard, AccountSection, RoleChip, QuickTile, AddBtn, AddressField, MiniBtn, SegBtn, LiveTag, tap, StepFade, PrimaryBtn, estTotal, jobCrewSize, jobTitle, jobSubtitle, Center } from './components2';
import { logError } from './errorService';
import { getPaymentForRequest, payoutStatus, startPayoutOnboarding } from './paymentsService';
import Invoice, { INVOICE_ENABLED } from './Invoice';
import { ReviewApprove, ReviewRow, MaterialsClaim, RateJob, SlidingText, workerLine, MatchCard, EmptyState, isStalledAssignment, requestHasStall, repLine, autoReleaseIn, friendly } from './components';

/* ============================================================ ROOT */
// ── DEV auto-login ──────────────────────────────────────────────────────────
// Skips the login screen during Snack development (Snack wipes the session on
// reload). Flip DEV_AUTOLOGIN to false — and it's a no-op — before any real
// build. The password is NOT committed: paste your test password locally.
// This is dev-only convenience; never ship it (CLAUDE.md §1).
const DEV_AUTOLOGIN = false;
const DEV_EMAIL = 'oddsmate.au@gmail.com';
const DEV_PASSWORD = '';   // ← paste your test password here locally; leave blank in the repo

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);
  const [pushDeepLink, setPushDeepLink] = useState(null);   // { request_id } from a tapped push
  // First-run routing: null → show the Welcome (choose-your-side) screen; once the user picks a
  // side (or taps "sign in") we set { mode, side } and hand off to the auth form. Never touched
  // once a session exists — returning users skip straight past it.
  const [authIntent, setAuthIntent] = useState(null);   // null | { mode: 'signin'|'signup', side: 'hire'|'work'|null }

  // Register this device for push whenever we have a signed-in user. Safe no-op in Snack
  // (no native module) — activates automatically in an EAS build. Also wires tap→deep-link.
  useEffect(() => {
    if (!session?.user?.id) return;
    registerForPush(session.user.id);
    const unsub = addPushTapListener((data) => {
      if (data && data.request_id) setPushDeepLink({ request_id: data.request_id, at: Date.now() });
    });
    return () => { unsub && unsub(); };
  }, [session?.user?.id]);

  useEffect(() => {
    let cancelled = false;
    // Warm the static trade taxonomy in parallel with the session check so the post-job picker and
    // trade lists open instantly the first time (it's memoised in taxonomyService after this).
    loadTaxonomy().catch(() => {});
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) {
        // Hydrate last session's screen data BEFORE mounting the shell → cold start paints instantly.
        await cacheHydrate(data.session.user.id);
        setSession(data.session); setBooting(false); return;
      }
      // no session — dev auto-login if enabled and a password is present
      if (DEV_AUTOLOGIN && DEV_PASSWORD) {
        try {
          const { data: signIn } = await supabase.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASSWORD });
          if (!cancelled) setSession(signIn.session);
        } catch (_) { /* fall through to the login screen */ }
      }
      if (!cancelled) setBooting(false);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  if (booting) return <View style={S_.authCanvas}><ActivityIndicator color={C.indigo} size="large" /></View>;
  if (session) return <Shell session={session} pushDeepLink={pushDeepLink} firstRunSide={authIntent?.side || null} />;
  // Signed out. Welcome and the auth form live on ONE shared canvas and CROSS-FADE between each other,
  // so choosing a side / going back never hard-cuts — it feels like one continuous surface.
  return (
    <CrossFade keyId={authIntent ? 'auth' : 'welcome'} style={S_.authCanvas}>
      {authIntent
        ? <Login intent={authIntent} onBack={() => setAuthIntent(null)} />
        : <Welcome onChoose={(side) => setAuthIntent({ mode: 'signup', side })}
                   onSignIn={() => setAuthIntent({ mode: 'signin', side: null })} />}
    </CrossFade>
  );

}

/* ============================================================ WELCOME (choose your side) */
// The first thing a new person sees. Deliberately ONE decision — which side are you here for —
// framed by benefit, the way Uber/DoorDash/Airtasker open. No fields, no friction; the two cards
// ARE the call to action. Whatever they pick seeds the signup so setup is tailored from step one.
const WELCOME_SIDES = [
  { side: 'hire', icon: 'users', accent: C.indigo,
    title: 'I need workers on site',
    blurb: 'Post a job and get skilled trades and labourers on site — often within the hour.' },
  { side: 'work', icon: 'labourer', accent: C.green,
    title: 'I want paid work',
    blurb: 'Find nearby jobs, get paid fast, and work when it suits you.' },
];
function Welcome({ onChoose, onSignIn }) {
  // Live proof — a real, quiet signal that this place is busy. Hidden entirely when there's nothing
  // to show yet (e.g. a fresh install with the bots cleared), so it never reads as fake.
  const [pulse, setPulse] = useState(null);
  useEffect(() => { getPulseStats().then(setPulse).catch(() => {}); }, []);
  const jobsToday = pulse?.jobs_completed_today || 0;
  const activeNow = pulse?.active_now || 0;
  const proof = jobsToday > 0
    ? { n: jobsToday, tail: jobsToday === 1 ? 'job done today around Sydney' : 'jobs done today around Sydney' }
    : activeNow > 0
      ? { n: activeNow, tail: activeNow === 1 ? 'person active right now' : 'people active right now' }
      : null;

  return (
    <View style={S_.wStage}>
      <StatusBar barStyle="dark-content" />
      <View style={S_.wTop}>
        <Entrance delay={0}>
          <View style={S_.wBrandRow}>
            <View style={S_.wMark}><Icon name="pin" size={20} color="#fff" strokeWidth={2.4} /></View>
            <Text style={S_.wBrandWord}>SiteCall</Text>
          </View>
        </Entrance>
        <Entrance delay={70}><Text style={S_.wHero}>Work starts here.</Text></Entrance>
        <Entrance delay={130}><Text style={S_.wSub}>Skilled trades and labour, on site fast — or paid work near you. Tell us what brings you in.</Text></Entrance>
        {proof && (
          <Entrance delay={190}>
            <View style={S_.wProof}>
              <View style={S_.wProofDot} />
              <Text style={S_.wProofT}><Text style={S_.wProofNum}>{proof.n}</Text> {proof.tail}</Text>
            </View>
          </Entrance>
        )}
      </View>

      <View style={S_.wCards}>
        {WELCOME_SIDES.map((s, i) => (
          <Entrance key={s.side} delay={250 + i * 90}>
            <PressableScale onPress={() => { tap(); onChoose(s.side); }} style={S_.wCard}>
              <View style={[S_.wIconChip, { backgroundColor: s.accent }]}>
                <Icon name={s.icon} size={22} color="#fff" strokeWidth={2.2} />
              </View>
              <View style={S_.wCardBody}>
                <Text style={S_.wCardTitle}>{s.title}</Text>
                <Text style={S_.wCardBlurb}>{s.blurb}</Text>
              </View>
              <View style={[S_.wCardGo, { backgroundColor: s.accent }]}>
                <Icon name="chevronRight" size={18} color="#fff" strokeWidth={2.6} />
              </View>
            </PressableScale>
          </Entrance>
        ))}
      </View>

      <Entrance delay={440}>
        <View style={S_.wBottom}>
          <TouchableOpacity onPress={onSignIn} style={S_.wSignIn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
            <Text style={S_.wSignInT}>Already have an account? <Text style={S_.wSignInLink}>Sign in</Text></Text>
          </TouchableOpacity>
          <Text style={S_.wTrust}>Free to join · Sydney &amp; NSW · Switch sides any time</Text>
        </View>
      </Entrance>
    </View>
  );
}

/* ============================================================ LOGIN */
function Login({ intent, onBack }) {
  // `intent` arrives from the Welcome screen: which mode to open in, and (for signup) the side the
  // person chose. We stash that side so the first-run setup checklist can tailor itself immediately.
  const [mode, setMode] = useState(intent?.mode || 'signin');   // 'signin' | 'signup' — explicit, never guessed
  const chosenSide = intent?.side || null;
  const [step, setStep] = useState(1);           // signup PACING only (presentation): 1 = email, 2 = password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');    // signup only
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgTone, setMsgTone] = useState('error');   // 'error' | 'info' — so colour signals meaning

  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  function switchMode(m) { setMode(m); setStep(1); setMsg(''); }
  // signup pacing: validate the email locally, then reveal the password step. No auth here.
  function next() {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setMsg('Enter a valid email address.'); setMsgTone('error'); return; }
    setMsg(''); setStep(2);
  }

  async function submit() {
    setMsgTone('error');
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setMsg('Enter a valid email address.'); return; }
    if (password.length < 6) { setMsg('Password must be at least 6 characters.'); return; }
    if (mode === 'signup' && password !== confirm) { setMsg('Passwords don\u2019t match.'); return; }
    setBusy(true); setMsg('');
    try {
      if (mode === 'signin') {
        // SIGN IN ONLY. Never creates an account. Wrong password / unknown email both return
        // "invalid login credentials" from Supabase (it doesn't reveal which, by design).
        const { error } = await supabase.auth.signInWithPassword({ email: e, password });
        if (error) {
          if (/invalid login credentials/i.test(error.message)) {
            setMsg('Wrong email or password. Forgot it? Tap “Forgot password?” below.');
          } else if (/email not confirmed/i.test(error.message)) {
            setMsg('Check your email to confirm your account, then sign in.'); setMsgTone('info');
          } else {
            setMsg(friendly(error));
          }
          setBusy(false); return;
        }
        // success → session set by the auth listener
      } else {
        // SIGN UP ONLY. Deliberate account creation. An existing email is rejected clearly —
        // no silent junk accounts, no "log straight into a new account" hole.
        const { data, error } = await supabase.auth.signUp({ email: e, password });
        if (error) {
          if (/already|registered|exists/i.test(error.message)) {
            setMsg('An account with that email already exists. Try signing in.');
          } else {
            setMsg(friendly(error));
          }
          setBusy(false); return;
        }
        // Remember the side they chose on Welcome so the first-run checklist opens on the right foot
        // (Shell reads this once on load). Survives the email-confirm round-trip via the local cache.
        if (chosenSide) cacheSet('onboard-side', chosenSide);
        if (!data.session) {
          // Email confirmation is on — no session yet. Tell them honestly.
          setMsg('Account created. Check your email to confirm, then sign in.'); setMsgTone('info');
          setMode('signin'); setStep(1); setBusy(false); return;
        }
        // success with immediate session → auth listener takes over
      }
    } catch (err) { setMsg(friendly(err)); } finally { setBusy(false); }
  }

  // Password recovery — sends a reset link to the entered email. Deliberately vague on whether the
  // email exists (never reveals account existence), and needs a valid email in the field first.
  async function resetPassword() {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setMsg('Enter your email above first, then tap “Forgot password?”.'); setMsgTone('error'); return; }
    setBusy(true); setMsg('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e);
      if (error) { setMsg(friendly(error)); setMsgTone('error'); }
      else { setMsg('If that email has an account, we’ve sent a link to reset your password. Check your inbox.'); setMsgTone('info'); }
    } catch (err) { setMsg(friendly(err)); setMsgTone('error'); }
    finally { setBusy(false); }
  }

  const isSignup = mode === 'signup';
  const sideVerb = chosenSide === 'hire' ? "Let's get you hiring" : chosenSide === 'work' ? "Let's get you earning" : "Let's get you set up";
  const heroTitle = !isSignup ? 'Welcome back' : step === 1 ? sideVerb : 'Create a password';
  const heroHelp  = !isSignup ? 'Sign in to your account' : step === 1 ? 'Start with your email' : 'At least 6 characters';
  const showEmail = !isSignup || step === 1;
  const showPass  = !isSignup || step === 2;

  return (
    <KeyboardAvoidingView style={S_.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="dark-content" />
      <View style={S_.loginWrap}>
        {/* quiet brand marker — recedes so the step headline is the hero */}
        <View style={S_.brandRow}>
          <View style={S_.markSm} />
          <Text style={S_.brandWord}>SiteCall</Text>
        </View>

        <StepFade phase={`${mode}-${step}`}>
          {/* Back always returns one step: signup step 2 → email; otherwise → the Welcome screen. */}
          <TouchableOpacity
            onPress={() => { if (isSignup && step === 2) { setStep(1); setMsg(''); } else { onBack && onBack(); } }}
            style={S_.loginBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
            <Text style={S_.loginBackT}>‹ Back</Text>
          </TouchableOpacity>

          {/* HERO — one dominant element per step */}
          <Text style={S_.loginHero}>{heroTitle}</Text>
          <Text style={S_.loginHelp}>{heroHelp}</Text>

          <View style={S_.loginFields}>
            {showEmail && (
              <>
                <Text style={[T.label, S_.loginLabel]}>Email</Text>
                <TextInput style={S_.loginInput} placeholder="you@example.com" placeholderTextColor={C.mute2}
                  autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
                  value={email} onChangeText={setEmail} editable={!busy}
                  autoFocus={isSignup && step === 1}
                  returnKeyType={isSignup ? 'next' : 'done'} onSubmitEditing={isSignup ? next : undefined} />
              </>
            )}
            {showPass && (
              <>
                <Text style={[T.label, S_.loginLabel, !isSignup && { marginTop: 16 }]}>Password</Text>
                <TextInput style={S_.loginInput} placeholder="at least 6 characters" placeholderTextColor={C.mute2}
                  secureTextEntry autoCapitalize="none" value={password} onChangeText={setPassword} editable={!busy}
                  autoFocus={isSignup && step === 2} />
              </>
            )}
            {isSignup && step === 2 && (
              <>
                <Text style={[T.label, S_.loginLabel, { marginTop: 16 }]}>Confirm password</Text>
                <TextInput style={S_.loginInput} placeholder="re-enter your password" placeholderTextColor={C.mute2}
                  secureTextEntry autoCapitalize="none" value={confirm} onChangeText={setConfirm} editable={!busy} />
              </>
            )}
          </View>

          <View style={S_.loginAction}>
            {isSignup && step === 1
              ? <PrimaryBtn label="Continue" onPress={next} />
              : <PrimaryBtn label={isSignup ? 'Create account' : 'Sign in'} onPress={submit} busy={busy} />}
          </View>

          {/* Forgot password — sign-in only, so the person can recover instead of making a duplicate account */}
          {!isSignup && (
            <TouchableOpacity onPress={resetPassword} disabled={busy} style={S_.loginForgot}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
              <Text style={S_.loginForgotT}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          {!!msg && <Text style={msgTone === 'error' ? S_.loginMsgErr : S_.loginMsgInfo}>{msg}</Text>}
        </StepFade>

        {/* quiet mode switch — a single line, never competing with the primary action */}
        <TouchableOpacity onPress={() => switchMode(isSignup ? 'signin' : 'signup')} style={S_.loginSwitch}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
          <Text style={S_.loginSwitchT}>
            {isSignup ? 'Already have an account? ' : 'New to SiteCall? '}
            <Text style={S_.loginSwitchLink}>{isSignup ? 'Sign in' : 'Create account'}</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ============================================================ SHELL (tab spine) */
const CLIENT_TABS = [
  { key: 'home', icon: 'home', label: 'Home' },
  { key: 'requests', icon: 'requests', label: 'Requests' },
  { key: 'activity', icon: 'activity', label: 'Activity' },
  { key: 'account', icon: 'account', label: 'Account' },
];
const OP_TABS = [
  { key: 'home', icon: 'home', label: 'Home' },
  { key: 'jobs', icon: 'jobs', label: 'Jobs' },
  { key: 'earnings', icon: 'earnings', label: 'Earnings' },
  { key: 'account', icon: 'account', label: 'Account' },
];

function Shell({ session, pushDeepLink, firstRunSide }) {
  // bind the screen cache to this user — if the account changes, the cache wipes itself so no
  // stale data from a previous session/account can ever paint. Safe by construction.
  cacheBindUser(session?.user?.id);
  // Default the VIEW to the side they signed up for (a fresh account has no capabilities yet, so
  // loadName's capability check won't override this). Returning users get re-pointed by loadName.
  const [role, setRoleSide] = useState(firstRunSide === 'work' ? 'operator' : 'client');  // client | operator — VIEW side only
  const [tab, setTab] = useState('home');
  // Floating island tab bar. Now that the home is a PINNED anchor (post bar + chips) with only a
  // short body to reveal, the hide-on-scroll behaviour felt twitchy and pointless — so the bar is
  // STATIC: always visible, never animated away. barTY stays 0; the scroll handler is a no-op.
  const barTY = useRef(new Animated.Value(0)).current;
  const onHomeScroll = () => {};   // static tab bar — no hide-on-scroll
  const revealBar = () => {};
  const changeTab = (k) => { setTab(k); };
  // TAB TRANSITIONS — the Home map is a PERMANENT base layer (mounted once, never reloads). The
  // other tabs (Requests/Activity/Account/Jobs/Earnings) are opaque overlays that cross-fade + slide
  // in over it. `activeOverlay` holds the visible non-home tab and lingers through the fade-OUT so
  // the exit animates before it unmounts. Home↔overlay cross-fades; overlay↔overlay swaps instantly.
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [activeOverlay, setActiveOverlay] = useState(null);
  useEffect(() => {
    if (tab === 'home') {
      Animated.timing(overlayAnim, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) setActiveOverlay(null); });
    } else {
      setActiveOverlay(tab);
      Animated.timing(overlayAnim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [wantNew, setWantNew] = useState(false);   // signal: open new-request flow on Requests
  const [focusReq, setFocusReq] = useState(null);  // signal: open a specific request on Requests
  const [myName, setMyName] = useState(null);      // personalisation: first name in the header
  const [acct, setAcct] = useState(null);          // identity + capabilities (drives the gate)
  const [gate, setGate] = useState(null);          // { side } when user taps a locked side
  const [profileId, setProfileId] = useState(null);  // public profile being viewed
  // First-run setup checklist. Only ever shown right after signup (firstRunSide is set by App from
  // the side chosen on Welcome). `setupDone` = they tapped through the celebration; `exploring` =
  // "I'll finish later". Either one retires the checklist for this session.
  const [setupDone, setSetupDone] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [setupManual, setSetupManual] = useState(null);   // a side to (re)open setup for, from a home prompt
  const [setupVersion, setSetupVersion] = useState(0);    // bumped when setup finishes → homes refetch
  // Steps the user has ACTED on this session, so the checklist reflects the action immediately even
  // before the (admin-approved) profile fields catch up. e.g. { verify: true, name: true }.
  const [setupSubmitted, setSetupSubmitted] = useState({});
  const markSubmitted = (key) => setSetupSubmitted((s) => ({ ...s, [key]: true }));
  // The ONE onboarding surface. Auto-opens right after signup (firstRunSide); can also be re-opened
  // from a home's "finish setup" prompt (setupManual). This is what replaced the old, separate
  // "Start working" form — there is now a single setup flow for each side.
  const setupSide = firstRunSide || setupManual;
  // Show the setup surface the instant we know we'll need it — even before the profile finishes
  // loading — so entering the app after signup lands on a calm branded cover, never a flash of the map.
  const showSetup = !!setupSide && !setupDone && !exploring;
  const openSetup = (side) => { setSetupSubmitted({}); setSetupDone(false); setExploring(false); setSetupManual(side); };
  const finishSetup = () => { setSetupDone(true); setSetupVersion((v) => v + 1); loadName(); };

  const loadName = useCallback(async () => {
    try {
      const p = await getMyProfile();
      setMyName((p.full_name || '').split(' ')[0] || null);
      if (p.full_name) cacheSet('profile-name', p.full_name);   // pre-warm so Account never flickers email→name
      setAcct(p);
      // default the VIEW to a side the account can actually do
      const canWorkSide = p && (p.can_work || p.can_task);
      if (p && !p.can_hire && canWorkSide) setRoleSide('operator');
      else if (p && p.can_hire && !canWorkSide) setRoleSide('client');
    } catch (_) {}
  }, []);
  useEffect(() => { loadName(); }, [loadName]);

  const canHire = !acct || acct.can_hire;   // before load, don't lock (avoids flash-lock)
  const canWork = !acct || acct.can_work || acct.can_task;  // Work side = site work OR task work

  const tabs = role === 'client' ? CLIENT_TABS : OP_TABS;

  // switching sides now respects capability — a locked side opens the "get verified" gate
  function switchRole(r) {
    if (r === 'client' && !canHire) { setGate({ side: 'hire' }); return; }
    if (r === 'operator' && !canWork) { setGate({ side: 'work' }); return; }
    setRoleSide(r); setTab('home'); revealBar();
  }
  function goPost() { setWantNew(true); setTab('requests'); revealBar(); }
  function goOpen(reqId) { setFocusReq(reqId); setTab('requests'); revealBar(); }

  // A tapped push notification deep-links to its job (open the request on the Requests tab).
  useEffect(() => {
    if (pushDeepLink && pushDeepLink.request_id) { setRoleSide('client'); goOpen(pushDeepLink.request_id); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushDeepLink?.at]);

  return (
    <View style={S_.fill}>
      <StatusBar barStyle="light-content" />
      {/* compact top bar with role switch — dark chrome, light content */}
      <View style={S_.topbar}>
        <View style={[S_.markSm, { backgroundColor: C.indigo }]}><Icon name="pin" size={17} color="#fff" strokeWidth={2.4} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[T.heading, { color: '#fff' }]}>SiteCall</Text>
          <Text style={[T.label, { fontSize: 9.5, marginTop: 1, color: 'rgba(255,255,255,0.55)' }]}>{myName ? `G'day, ${myName}` : session.user.email}</Text>
        </View>
        <RoleToggle role={role} canHire={canHire} canWork={canWork} onSelect={switchRole} />
      </View>

      {/* tab content */}
      <View style={{ flex: 1 }}>
        {/* PERSISTENT HOME BASE — mounted once, forever. Both Hire/Work homes stay mounted (toggled by
            visibility) so the map never reloads, whether switching Hire↔Work OR leaving to another
            tab and coming back. Non-home tabs render as fading overlays ON TOP of this. */}
        <View style={StyleSheet.absoluteFill} pointerEvents={tab === 'home' ? 'auto' : 'none'}>
          <View style={[S_.homeLayer, role !== 'client' && S_.homeHidden]} pointerEvents={role === 'client' ? 'auto' : 'none'}>
            <ClientHome session={session} onPost={goPost} onOpenReq={goOpen} onOpenProfile={setProfileId} onScroll={onHomeScroll} />
          </View>
          <View style={[S_.homeLayer, role !== 'operator' && S_.homeHidden]} pointerEvents={role === 'operator' ? 'auto' : 'none'}>
            <OperatorHome session={session} onOpenProfile={setProfileId} onScroll={onHomeScroll}
              onOpenSetup={() => openSetup('work')} setupVersion={setupVersion} />
          </View>
        </View>
        {/* OVERLAY TABS — cross-fade + subtle slide over the map. Kept mounted through the fade-out. */}
        {activeOverlay && (
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: C.canvas, opacity: overlayAnim, transform: [{ translateY: overlayAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
            pointerEvents={tab === 'home' ? 'none' : 'auto'}
          >
            {/* overlay↔overlay swaps (e.g. Jobs→Earnings) cross-fade instead of hard-cutting */}
            <CrossFade keyId={`${role}:${activeOverlay}`} style={{ flex: 1 }}>
            {role === 'client' ? (
              activeOverlay === 'requests' ? <ClientRequests session={session} openNew={wantNew} onOpenedNew={() => setWantNew(false)} focusReq={focusReq} onFocused={() => setFocusReq(null)} />
              : activeOverlay === 'activity' ? <ClientActivity session={session} />
              : <Account session={session} role="client" onNameSaved={loadName} onOpenProfile={setProfileId} />
            ) : (
              activeOverlay === 'jobs' ? <OperatorJobs session={session} onOpenProfile={setProfileId} />
              : activeOverlay === 'earnings' ? <OperatorEarnings session={session} />
              : <Account session={session} role="operator" onNameSaved={loadName} onOpenProfile={setProfileId} />
            )}
            </CrossFade>
          </Animated.View>
        )}
      </View>

      <TabBar tabs={tabs} active={tab} onChange={changeTab} translateY={barTY} accent={role === 'client' ? C.indigo : C.green} />
      {/* MomentToasts retired: the Live Tracker card now covers lifecycle moments calmly and
          persistently, so the popping toasts were redundant (competing peers). Kept the import
          so it's a one-line re-enable if we ever want it for events the tracker doesn't cover. */}
      {/* <MomentToasts /> */}
      {showSetup && (
        <View style={StyleSheet.absoluteFill}>
          <SetupChecklist
            side={setupSide}
            acct={acct}
            submitted={setupSubmitted}
            onSubmitted={markSubmitted}
            onOpenGate={(g) => setGate(typeof g === 'string' ? { side: g } : g)}
            onRefresh={loadName}
            onExplore={() => { setExploring(true); setSetupManual(null); }}
            onComplete={() => { finishSetup(); setSetupManual(null); }}
          />
        </View>
      )}
      <CapabilityGate
        gate={gate}
        onClose={() => setGate(null)}
        onUnlocked={() => { markSubmitted('verify'); setGate(null); loadName(); }}
      />
      <PublicProfile visible={!!profileId} userId={profileId} meId={session.user.id} onClose={() => setProfileId(null)} />
    </View>
  );
}

// The gate shown when a user taps a side they haven't unlocked. It routes them into REAL
// verification: submit a credential / ABN → it lands 'pending' → an admin (or the SafeWork/ABR
// API) approves → capability is granted server-side. No self-granting: a client can never mark
// itself verified (enforced by RLS + server functions). This is safety-critical for site work.
function CapabilityGate({ gate, onClose, onUnlocked }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [num, setNum] = useState('');
  React.useEffect(() => { if (gate) { setDone(false); setErr(''); setNum(''); setBusy(false); } }, [gate]);
  if (!gate) return null;
  const isHire = gate.side === 'hire';
  const isTask = gate.side === 'task';
  // Which credential this gate is for. The checklist can pass a specific one (credId/credName) so we
  // ask for exactly the ticket the worker's trades need; otherwise fall back to the side's default.
  const credId = gate.credId || (isTask ? 'drivers_licence' : 'white_card');
  const credName = gate.credName || (isTask ? 'driver licence' : 'White Card');
  const title = isHire ? 'Add your ABN' : `Add your ${credName}`;
  const need = isHire
    ? "Pop in your ABN and we'll confirm your business in the background. You can carry on while we check."
    : `Pop in your ${credName} number and we'll check it in the background. You can carry on while we do.`;
  const inputLabel = isHire ? 'ABN' : `${credName} number`;
  const inputHint = isHire ? '11 digits' : 'the number on your card';
  const submitLabel = isHire ? 'Add ABN' : 'Add ticket';

  async function submit() {
    setBusy(true); setErr('');
    try {
      if (isHire) {
        await submitBusinessAbn(num);
      } else {
        await submitCredential(credId, num || null, null);
      }
      setDone(true);
    } catch (e) {
      setErr(friendly ? friendly(e) : (e.message || 'Submission failed'));
    } finally { setBusy(false); }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={S_.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={S_.gateScrim}>
        <View style={S_.gateCard}>
          {done ? (
            <>
              <View style={S_.gatePendingBadge}><Text style={S_.gatePendingBadgeT}>Checking</Text></View>
              <Text style={S_.gateTitle}>Nice — that’s in</Text>
              <Text style={S_.gateSub}>
                {isHire
                  ? "We’re confirming your business now. You can start straight away — we’ll let you know the moment it’s done."
                  : "We’re checking your ticket now. Have a look around in the meantime — we’ll let you know the moment it’s done."}
              </Text>
              <TouchableOpacity style={S_.gateBtn} onPress={() => { onUnlocked && onUnlocked(); }}>
                <Text style={S_.gateBtnT}>Great</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={S_.gateTitle}>{title}</Text>
              <Text style={S_.gateSub}>{need}</Text>
              <Text style={S_.gateInputLabel}>{inputLabel}</Text>
              <TextInput
                style={S_.gateInput} value={num} onChangeText={setNum}
                placeholder={inputHint} placeholderTextColor={C.mute2}
                keyboardType={isHire ? 'number-pad' : 'default'}
                autoCapitalize="characters"
              />
              {!!err && <Text style={S_.gateErr}>{err}</Text>}
              <TouchableOpacity style={[S_.gateBtn, (busy || !num.trim()) && { opacity: 0.5 }]} onPress={submit} disabled={busy || !num.trim()}>
                <Text style={S_.gateBtnT}>{busy ? 'Saving…' : submitLabel}</Text>
              </TouchableOpacity>
              {/* Resource: many workers don't have their White Card yet — turn a dead-end into a path. */}
              {!isHire && credId === 'white_card' && (
                <TouchableOpacity style={{ paddingVertical: 10 }} activeOpacity={0.8}
                  onPress={() => Linking.openURL('https://www.safework.nsw.gov.au/licences-and-registrations/general-construction-induction-training-white-cards').catch(() => {})}>
                  <Text style={S_.gateResource}>Don’t have one yet? How to get a White Card →</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10 }}>
                <Text style={S_.gateCancel}>Maybe later</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ============================================================ SETUP CHECKLIST (first-run) */
// The payoff after signup. Instead of dropping a new person into an empty app, we land them on a
// short "get ready" checklist tailored to the side they chose on Welcome. Each step is either done
// (green tick), actionable now (tap → real flow), or under review (background verification, e.g.
// ABN/White Card). A live activity strip keeps it feeling alive. When every required step is done,
// it turns into a celebration and hands them into the app. Verification reuses the CapabilityGate.
function SetupChecklist({ side, acct, submitted, onSubmitted, onOpenGate, onRefresh, onExplore, onComplete }) {
  const isHire = side === 'hire';
  const sub = submitted || {};
  const [payout, setPayout] = useState(null);       // work side only: connect-status result
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(acct?.full_name || '');
  const [dobVal, setDobVal] = useState('');       // work side only: DD/MM/YYYY (identity for register checks)
  const [nameErr, setNameErr] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [pulse, setPulse] = useState(null);
  // Trades (work side): the "what can you do" multi-select. Picking trades creates capabilities, which
  // is what makes jobs show up in the feed — value-first, before any credential is asked for.
  const [tradesOpen, setTradesOpen] = useState(false);
  const [tax, setTax] = useState(null);
  const [selTrades, setSelTrades] = useState({});   // trade_id -> trade object
  const [tradeQ, setTradeQ] = useState('');
  const [tradesBusy, setTradesBusy] = useState(false);
  const [capsCount, setCapsCount] = useState(null); // how many capabilities are on file (drives 'done')
  const [reqTix, setReqTix] = useState(null);       // tickets the chosen trades require (tailored verify)
  const [payoutErr, setPayoutErr] = useState('');   // surfaced when opening Stripe fails (money — never silent)

  useEffect(() => {
    if (isHire) return;
    loadTaxonomy().then(setTax).catch(() => setTax({ categories: [], trades: [] }));
    listMyCapabilities().then((caps) => {
      setCapsCount(caps.length);
      const seed = {};
      caps.forEach((c) => { if (c.trade_id) seed[c.trade_id] = { id: c.trade_id, name: c.type, kind: c.kind }; });
      setSelTrades(seed);
    }).catch(() => setCapsCount(0));
  }, [isHire]);

  // Whenever the picked trades change, recompute exactly which tickets those trades require. This is
  // what makes the "verify" step feel custom-built — it names the worker's actual tickets.
  const tradeKey = Object.keys(selTrades).sort().join(',');
  useEffect(() => {
    if (isHire) return;
    const ids = Object.keys(selTrades);
    if (!ids.length) { setReqTix([]); return; }
    requiredTicketsForTrades(ids).then(setReqTix).catch(() => setReqTix([]));
  }, [isHire, tradeKey, acct?.can_work]);

  // Work "details" = name + DOB + becoming an operator (role flips to 'operator', which persists), so
  // the app never asks for the name/DOB a second time. Hire "details" = just a display name.
  const hasName = isHire
    ? (!!(acct?.full_name && acct.full_name.trim()) || !!sub.name)
    : (acct?.role === 'operator' || !!sub.name);
  const verified = isHire ? !!acct?.can_hire : !!(acct?.can_work || acct?.can_task);
  // "Under review" = the profile says pending OR they just submitted it this session (the profile
  // field only flips once an admin/register approves, so we can't wait for it to show progress).
  const verifyPending = !!sub.verify
    || (isHire
      ? (acct?.company_verify_status === 'pending' || acct?.abn_status === 'pending')
      : (acct?.worker_verify_status === 'pending'));

  // Work side needs a payout account before it's "ready". Re-check whenever verification changes
  // (and after they return from Stripe and tap refresh).
  const loadPayout = useCallback(() => {
    if (isHire) return;
    payoutStatus().then(setPayout).catch(() => setPayout({ payouts_enabled: false }));
  }, [isHire]);
  useEffect(() => { loadPayout(); }, [loadPayout, acct?.can_work, acct?.can_task]);
  useEffect(() => { getPulseStats().then(setPulse).catch(() => {}); }, []);

  const paidReady = isHire ? true : !!payout?.payouts_enabled;

  async function saveName() {
    const n = nameVal.trim();
    setNameErr('');
    if (n.length < 2) { setNameErr('Enter your full name.'); return; }
    setSavingName(true);
    try {
      if (isHire) {
        await updateMyName(n);
      } else {
        // Work side: this is the ONE identity step. Capture legal name + DOB (for register checks) and
        // become an operator in a single save — replaces the old separate "Start working" form.
        const iso = dmyToISO(dobVal);
        if (!iso) { setNameErr('Enter your date of birth as DD/MM/YYYY.'); setSavingName(false); return; }
        await setMyIdentity(n, iso);   // sets legal_name + DOB, seeds full_name if empty
        await updateMyName(n);         // ensure the display name is set too
        await setRole('operator');     // they are now a worker — this persists, so no re-ask later
      }
      onSubmitted && onSubmitted('name'); setEditingName(false); onRefresh && (await onRefresh());
    } catch (e) { setNameErr(friendly ? friendly(e) : (e.message || 'Could not save.')); }
    finally { setSavingName(false); }
  }
  async function startPayout() {
    setPayoutBusy(true); setPayoutErr('');
    try { await startPayoutOnboarding(); }
    catch (e) { setPayoutErr(friendly ? friendly(e) : (e?.message || 'Couldn’t open payout setup — please try again.')); }
    finally { setPayoutBusy(false); }
  }
  const toggleTrade = (t) => setSelTrades((prev) => {
    const n = { ...prev }; if (n[t.id]) delete n[t.id]; else n[t.id] = { id: t.id, name: t.name, kind: t.kind }; return n;
  });
  async function saveTrades() {
    setTradesBusy(true);
    try {
      const existing = await listMyCapabilities();
      const existingByTrade = {}; existing.forEach((c) => { if (c.trade_id) existingByTrade[c.trade_id] = c; });
      const selIds = Object.keys(selTrades);
      for (const id of selIds) {
        if (!existingByTrade[id]) {
          const t = selTrades[id];
          const legacyKind = t.kind === 'plant' ? 'gear' : t.kind;
          await addCapability(legacyKind, t.name, t.id);
        }
      }
      for (const c of existing) if (c.trade_id && !selTrades[c.trade_id]) await removeCapability(c.id);
      const fresh = await listMyCapabilities();
      setCapsCount(fresh.length);
      onSubmitted && onSubmitted('trades');
      setTradesOpen(false);
      onRefresh && (await onRefresh());
    } catch (_) {} finally { setTradesBusy(false); }
  }

  // Build the step list for this side. state ∈ 'done' | 'todo' | 'review' | 'loading'
  const steps = [];
  steps.push({
    key: 'name',
    title: isHire ? 'Your name or business' : 'Your details',
    sub: isHire ? 'Shown to the workers you hire' : 'Name + date of birth — so we can check your tickets',
    state: hasName ? 'done' : 'todo',
  });
  const tradeCount = Object.keys(selTrades).length;
  if (!isHire) steps.push({
    key: 'trades',
    title: 'What work can you do?',
    sub: tradeCount > 0 ? `${tradeCount} selected — tap to change` : 'Pick your trades so we can match you to jobs',
    state: (capsCount == null) ? 'loading' : ((capsCount > 0 || !!sub.trades) ? 'done' : 'todo'),
  });
  // Tailored verify — name the exact tickets the worker's chosen trades need, not a generic "White Card".
  const reqNames = (reqTix || []).map((t) => t.name);
  const nextTicket = (reqTix || []).find((t) => !t.held) || (reqTix || []).find((t) => !t.verified) || null;
  const verifyTitle = isHire ? 'Add your ABN'
    : reqNames.length === 1 ? `Add your ${reqNames[0]}`
    : reqNames.length > 1 ? 'Add your tickets'
    : 'Add your White Card';
  const verifySub = isHire ? 'Pop in your ABN — we confirm your business for you'
    : reqNames.length ? `For your trades: ${reqNames.join(', ')}`
    : 'Pop in your card number — we check it for you';
  steps.push({
    key: 'verify',
    title: verifyTitle,
    sub: verifySub,
    state: verified ? 'done' : verifyPending ? 'review' : 'todo',
  });
  if (!isHire) steps.push({
    key: 'payout',
    optional: true,   // you can finish setup and reach the app without a bank — prompted later at go-online
    title: 'Set up payouts',
    sub: paidReady ? 'Linked — your pay lands fast' : 'Optional now — add your bank when you’re ready to get paid',
    state: paidReady ? 'done' : payout == null ? 'loading' : 'todo',
  });

  // A step counts as "handled" once it's done OR submitted for review — the user has done their part,
  // so onboarding can finish while a background check clears (verify-now, validate-later). Optional
  // steps (payouts) never block completion — the worker can proceed to the app and set it up later.
  const handled = (s) => s.state === 'done' || s.state === 'review';
  const requiredSteps = steps.filter((s) => !s.optional);
  const total = requiredSteps.length;
  const doneCount = requiredSteps.filter(handled).length;
  const allDone = requiredSteps.every(handled);
  const stillReviewing = steps.some((s) => s.state === 'review');
  const payoutTodo = !isHire && !paidReady;   // for the celebration's "set up payouts later" note
  const pct = total ? doneCount / total : 0;

  function handleStep(step) {
    if (step.state === 'done' || step.state === 'review' || step.state === 'loading') return;
    tap();
    if (step.key === 'name') { setNameVal(acct?.full_name || ''); setEditingName(true); }
    else if (step.key === 'trades') setTradesOpen(true);
    else if (step.key === 'verify') {
      // Open the gate for the exact ticket their trades need next; fall back to the side default.
      if (!isHire && nextTicket) onOpenGate({ side: 'work', credId: nextTicket.credential_id, credName: nextTicket.name });
      else onOpenGate({ side });
    }
    else if (step.key === 'payout') startPayout();
  }

  const activeNow = pulse?.active_now || 0;

  // Branded cover while the profile loads — this is what masks the app-entry moment right after
  // signup, so the transition into the checklist is flush instead of flashing the map behind it.
  if (!acct) {
    return (
      <View style={[S_.setStage, { alignItems: 'center', justifyContent: 'center' }]}>
        <StatusBar barStyle="dark-content" />
        <View style={S_.setBrandMark}><Icon name="pin" size={24} color="#fff" strokeWidth={2.4} /></View>
        <Text style={S_.setLoadingT}>Setting things up…</Text>
      </View>
    );
  }

  // Trades multi-select — pick the work you do. Selecting creates capabilities, which is what makes
  // jobs appear in the feed. No credentials here; that's the separate (later) "verify to accept" gate.
  if (tradesOpen) {
    const featured = tax ? featuredTrades(tax, 14) : [];
    const results = (tax && tradeQ.trim()) ? searchTrades(tax, tradeQ) : [];
    const list = tradeQ.trim() ? results : featured;
    return (
      <View style={S_.setStage}>
        <StatusBar barStyle="dark-content" />
        <View style={S_.tradesTop}>
          <TouchableOpacity onPress={() => setTradesOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }} activeOpacity={0.7}>
            <Icon name="chevronLeft" size={22} color={C.ink} strokeWidth={2.4} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>Back</Text>
          </TouchableOpacity>
          <Text style={S_.setHero}>What work can you do?</Text>
          <Text style={S_.setSub}>Pick everything you can take on — it's how we match you to nearby jobs. You can always change this later.</Text>
          <View style={S_.tradesSearch}>
            <Icon name="search" size={16} color={C.mute} strokeWidth={2.2} />
            <TextInput style={S_.tradesSearchInput} value={tradeQ} onChangeText={setTradeQ}
              placeholder="Search — traffic, cleaner, excavator…" placeholderTextColor={C.mute2} autoCorrect={false} />
            {!!tradeQ && <TouchableOpacity onPress={() => setTradeQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={{ color: C.mute2, fontWeight: '700', fontSize: 15 }}>✕</Text></TouchableOpacity>}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 20 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {!tax ? <ActivityIndicator color={C.green} style={{ marginTop: 20 }} />
            : list.length === 0 ? <Text style={[S_.setSub, { marginTop: 16 }]}>No match — try another word.</Text>
            : (
              <View style={S_.tradesWrap}>
                {list.map((t) => {
                  const on = !!selTrades[t.id];
                  return (
                    <TouchableOpacity key={t.id} onPress={() => { tap(); toggleTrade(t); }} activeOpacity={0.85}
                      style={[S_.tradeChip, on && S_.tradeChipOn]}>
                      {on && <Icon name="check" size={15} color="#fff" strokeWidth={3} />}
                      <Text style={[S_.tradeChipT, on && S_.tradeChipTOn]}>{tradeTitle(t.name)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
        </ScrollView>
        <View style={S_.setFooter}>
          {/* Live earnings preview — honest, award-guided rates for the trades they've picked. This is
              the money moment that gets a worker to finish setup. */}
          {(() => {
            const picks = Object.values(selTrades);
            if (!picks.length) return null;
            const rateOf = (name) => RATES[name] || [30, 42, 58];
            const mids = picks.map((p) => rateOf(p.name)[1]);
            const typical = Math.round(mids.reduce((a, b) => a + b, 0) / mids.length);
            const top = Math.max(...picks.map((p) => rateOf(p.name)[2]));
            return (
              <View style={S_.earnPrev}>
                <View style={{ flex: 1 }}>
                  <Text style={S_.earnLabel}>You could earn</Text>
                  <Text style={S_.earnBig}>~${typical}<Text style={S_.earnUnit}>/hr</Text></Text>
                </View>
                <Text style={S_.earnTop}>up to ${top}/hr{'\n'}on the best jobs</Text>
              </View>
            );
          })()}
          <PrimaryBtn label={tradeCount > 0 ? `Save ${tradeCount} trade${tradeCount === 1 ? '' : 's'}` : 'Pick at least one'}
            onPress={saveTrades} busy={tradesBusy} disabled={tradeCount === 0} />
        </View>
      </View>
    );
  }

  return (
    <View style={S_.setStage}>
      <StatusBar barStyle="dark-content" />
      <Entrance from={12} style={S_.fill}>
      <ScrollView contentContainerStyle={S_.setScroll} showsVerticalScrollIndicator={false}>
        {/* header — celebration when finished, otherwise the progress hero */}
        {allDone ? (
          <View style={S_.setHeader}>
            <View style={[S_.setBadge, { backgroundColor: isHire ? C.indigo : C.green }]}>
              <Icon name="check" size={26} color="#fff" strokeWidth={3} />
            </View>
            <Text style={S_.setHero}>You're all set</Text>
            <Text style={S_.setSub}>
              {isHire
                ? (stillReviewing ? "You can start posting jobs now — we're finishing your verification in the background." : "You're ready to post jobs and hire.")
                : payoutTodo
                  ? "You're in! Have a look around — link your bank from Earnings whenever you're ready to get paid."
                  : (stillReviewing ? "You can look around now — we're finishing your verification in the background, then you can accept jobs." : "You're ready to find work and get paid.")}
            </Text>
          </View>
        ) : (
          <View style={S_.setHeader}>
            <Text style={S_.setKicker}>{isHire ? 'GET READY TO HIRE' : 'GET READY TO WORK'}</Text>
            <Text style={S_.setHero}>A couple of quick steps</Text>
            <Text style={S_.setSub}>Finish these and you're ready to go. We'll verify the slow bits in the background.</Text>
            <View style={S_.setProgWrap}>
              <View style={S_.setProgTrack}>
                <View style={[S_.setProgFill, { width: `${Math.round(pct * 100)}%`, backgroundColor: isHire ? C.indigo : C.green }]} />
              </View>
              <Text style={S_.setProgT}>{doneCount} of {total} done</Text>
            </View>
          </View>
        )}

        {/* live strip — "this place is alive" */}
        {activeNow > 0 && (
          <View style={S_.setLive}>
            <View style={S_.setLiveDot} />
            <Text style={S_.setLiveT}><Text style={S_.setLiveNum}>{activeNow}</Text> {activeNow === 1 ? 'person' : 'people'} active on SiteCall right now</Text>
          </View>
        )}

        {/* How it works — a calm 3-beat explainer so expectations are set before they even finish */}
        {!allDone && (
          <View style={S_.hiwRow}>
            {(isHire
              ? [{ icon: 'requests', t: 'Post a job' }, { icon: 'users', t: 'Get matched' }, { icon: 'check', t: 'Work gets done' }]
              : [{ icon: 'search', t: 'Get matched' }, { icon: 'labourer', t: 'Do the job' }, { icon: 'payment', t: 'Paid fast' }]
            ).map((h, idx) => (
              <React.Fragment key={h.t}>
                {idx > 0 && <Icon name="chevronRight" size={15} color={C.mute2} strokeWidth={2.4} />}
                <View style={S_.hiwStep}>
                  <View style={[S_.hiwIcon, { backgroundColor: (isHire ? C.indigo : C.green) + '14' }]}>
                    <Icon name={h.icon} size={17} color={isHire ? C.indigo : C.green} strokeWidth={2.2} />
                  </View>
                  <Text style={S_.hiwT}>{h.t}</Text>
                </View>
              </React.Fragment>
            ))}
          </View>
        )}

        {/* steps */}
        <View style={S_.setSteps}>
          {steps.map((s, i) => {
            const accent = isHire ? C.indigo : C.green;
            const isName = s.key === 'name';
            return (
              <View key={s.key}>
                <PressableScale onPress={() => handleStep(s)} disabled={s.state !== 'todo'} style={S_.setStep}>
                  <View style={[
                    S_.setStepIcon,
                    s.state === 'done' && { backgroundColor: accent, borderColor: accent },
                    s.state === 'review' && { backgroundColor: C.panel2, borderColor: C.amber },
                    s.state === 'todo' && { borderColor: accent },
                  ]}>
                    {s.state === 'done' ? <Icon name="check" size={16} color="#fff" strokeWidth={3} />
                      : s.state === 'loading' ? <ActivityIndicator size="small" color={C.mute2} />
                      : <Text style={[S_.setStepNum, s.state === 'review' && { color: C.amber }, s.state === 'todo' && { color: accent }]}>{i + 1}</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S_.setStepTitle, s.state === 'done' && { color: C.mute }]}>{s.title}</Text>
                    <Text style={S_.setStepSub}>
                      {s.state === 'review' ? 'We’re checking this for you — you can keep going' : s.sub}
                    </Text>
                  </View>
                  {s.state === 'todo' && <Icon name="chevronRight" size={18} color={C.mute2} strokeWidth={2.4} />}
                  {s.state === 'review' && <View style={S_.setPill}><Text style={S_.setPillT}>Checking</Text></View>}
                </PressableScale>

                {/* inline details editor — name (both sides) + DOB (work side, for register checks) */}
                {isName && editingName && (
                  <View style={S_.setInline}>
                    <TextInput style={S_.setInput} value={nameVal} onChangeText={setNameVal}
                      placeholder={isHire ? 'Your name or business' : 'Full name, as on your licence'} placeholderTextColor={C.mute2}
                      autoFocus autoCapitalize="words" editable={!savingName} />
                    {!isHire && (
                      <TextInput style={[S_.setInput, { marginTop: 10 }]} value={dobVal}
                        onChangeText={(t) => setDobVal(formatDMY(t))}
                        placeholder="Date of birth — DD/MM/YYYY" placeholderTextColor={C.mute2}
                        keyboardType="number-pad" editable={!savingName} />
                    )}
                    {!isHire && <Text style={S_.setInlineHint}>Used only to check your tickets against the registers — never shown publicly.</Text>}
                    {!!nameErr && <Text style={S_.setInlineErr}>{nameErr}</Text>}
                    <View style={S_.setInlineBtns}>
                      <TouchableOpacity onPress={() => { setEditingName(false); setNameErr(''); }} style={S_.setInlineCancel}>
                        <Text style={S_.setInlineCancelT}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={saveName} disabled={savingName}
                        style={[S_.setInlineSave, savingName && { opacity: 0.5 }]}>
                        <Text style={S_.setInlineSaveT}>{savingName ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* payout: after launching Stripe, a gentle re-check + any error (money is never silent) */}
                {s.key === 'payout' && s.state === 'todo' && payout != null && (
                  <TouchableOpacity onPress={loadPayout} style={S_.setRecheck} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={S_.setRecheckT}>Finished in the browser? Tap to refresh</Text>
                  </TouchableOpacity>
                )}
                {s.key === 'payout' && !!payoutErr && <Text style={S_.setInlineErr}>{payoutErr}</Text>}
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* footer action */}
      <View style={S_.setFooter}>
        {allDone
          ? <PrimaryBtn label={isHire ? 'Start hiring' : 'Start working'} onPress={() => { tap(); onComplete && onComplete(); }} />
          : (
            <TouchableOpacity onPress={onExplore} style={S_.setExplore} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={S_.setExploreT}>I'll finish later — <Text style={S_.setExploreLink}>explore first</Text></Text>
            </TouchableOpacity>
          )}
      </View>
      </Entrance>
    </View>
  );
}

/* ============================================================ CLIENT · HOME (hero map) */
/* ============================================================ RISING REQUEST SHEET */
const SHEET_SCREEN_H = Dimensions.get('window').height;
const SHEET_RATES = {
  'Excavator': 110, 'Line pump': 180, 'Dozer': 160, 'Tipper': 120, 'Mobile crane': 250, 'Water cart': 110,
  'Labourer': 40, 'Traffic controller': 38, 'Machine operator': 55, 'Dogman / rigger': 60, 'Spotter': 45, 'Concreter': 58,
  'Bunnings pickup': 30, 'Parts run': 30, 'Bin / tip run': 50, 'Materials drop': 40,
};
const sheetRateFor = (name, kind) => SHEET_RATES[name] || (kind === 'task' ? 40 : 55);

// Picker v2 styles — popular shortcuts + collapsed folders + search.
const pk = StyleSheet.create({
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.panel2 || '#F0F0EE', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6, borderWidth: 1, borderColor: C.line },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 15, color: C.ink, padding: 0 },
  searchClear: { fontSize: 15, color: C.mute2, fontWeight: '700', paddingHorizontal: 2 },
  sectionT: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.8, color: C.mute, marginTop: 18, marginBottom: 10 },
  featWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  featChip: { backgroundColor: C.indigo, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 11 },
  featChipT: { color: '#fff', fontSize: 14, fontWeight: '800' },
  folder: { borderTopWidth: 1, borderTopColor: C.line },
  folderHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  folderDot: { width: 10, height: 10, borderRadius: 5 },
  folderTitle: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  folderCount: { fontSize: 13, fontWeight: '700', color: C.mute2 },
  folderSub: { fontSize: 12, color: C.mute, marginTop: 2, fontWeight: '600' },
  folderChev: { fontSize: 22, color: C.mute2, fontWeight: '300' },
});

function RequestSheet({ visible, onClose, myLoc, onPosted, prefill }) {
  const y = useRef(new Animated.Value(SHEET_SCREEN_H)).current;
  const dim = useRef(new Animated.Value(0)).current;
  // `shown` keeps the Modal mounted through the slide-OUT animation (it only unmounts once the
  // exit finishes). Rendering inside a Modal portals the sheet ABOVE the floating tab bar, so the
  // island can never cover the picker (e.g. the Equipment & plant folder at the bottom).
  const [shown, setShown] = useState(false);
  const [tax, setTax] = useState(null);
  const [phase, setPhase] = useState('door');
  const [door, setDoor] = useState(null);
  const [cat, setCat] = useState(null);
  const [openCats, setOpenCats] = useState({});   // picker accordion: which folders are expanded
  const [pickQ, setPickQ] = useState('');         // picker search query
  const [items, setItems] = useState([]);
  const [loc, setLoc] = useState('');
  const [coords, setCoords] = useState(null);
  const [resolving, setResolving] = useState(false);   // geocoding the typed address on "Next"
  const [when, setWhen] = useState('now');
  const [schedDay, setSchedDay] = useState(0);    // 0=today, 1=tomorrow, ... offset in days
  const [schedHour, setSchedHour] = useState(9);  // 24h local hour chosen for a booked job
  const [duration, setDuration] = useState(4);    // expected job length (hrs) — drives every pay estimate
  const [openAddons, setOpenAddons] = useState({});   // which optional extras are revealed (progressive, not a wall of boxes)
  const [contactName, setContactName] = useState('');   // optional site contact (who to ask for)
  const [contactPhone, setContactPhone] = useState(''); // optional site contact phone
  const [materialsCap, setMaterialsCap] = useState(''); // optional materials budget
  const [travel, setTravel] = useState('');             // optional travel allowance ($, 100% to worker)
  const [jobDetails, setJobDetails] = useState('');     // duties — what the worker will do (shown before accepting)
  const [pickupText, setPickupText] = useState('');     // runs only: where to buy (plain text, e.g. "Bunnings Alexandria")
  const [busy, setBusy] = useState(false);
  const [locBusy, setLocBusy] = useState(false);   // reverse-geocoding "use my location"
  const [err, setErr] = useState('');
  const [kbH, setKbH] = useState(0);   // live keyboard height so the sheet lifts just enough

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => setKbH(e.endCoordinates?.height || 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  useEffect(() => { loadTaxonomy().then(setTax).catch(() => setTax({ categories: [], trades: [] })); }, []);

  useEffect(() => {
    if (visible) {
      setShown(true);   // mount the Modal, then slide in
      Animated.parallel([
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220, mass: 0.9 }),
        Animated.timing(dim, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else if (shown) {
      Animated.parallel([
        Animated.timing(y, { toValue: SHEET_SCREEN_H, duration: 240, useNativeDriver: true }),
        Animated.timing(dim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => { setShown(false); setPhase('door'); setDoor(null); setCat(null); setItems([]); setLoc(''); setCoords(null); setWhen('now'); setErr(''); setContactName(''); setContactPhone(''); setMaterialsCap(''); setTravel(''); setJobDetails(''); setPickupText(''); setSchedDay(0); setSchedHour(9); setDuration(4); setOpenAddons({}); setPickQ(''); setOpenCats({}); });
    }
  }, [visible]);

  // "Post again" — a repeat client's one-tap re-post. Seed the trades from a past job and jump
  // straight to WHERE (location is re-confirmed every time so the geofence coords are fresh and
  // the site can change). Skips the whole trade+rate picker, which is the tedious part.
  useEffect(() => {
    if (visible && prefill && Array.isArray(prefill.items) && prefill.items.length) {
      setItems(prefill.items);
      setPhase(prefill.phase || 'where');
    }
  }, [visible, prefill]);

  function pickTrade(t) {
    tap('medium');
    const kind = t.kind === 'plant' ? 'gear' : t.kind;
    const ex = items.find((i) => i.trade_id === t.id);
    if (ex) setItems(items.map((i) => i.trade_id === t.id ? { ...i, qty: i.qty + 1 } : i));
    else setItems([...items, { trade_id: t.id, kind, type: t.name, qty: 1, rate: sheetRateFor(t.name, kind), priceMode: kind === 'task' ? 'job' : 'hour', tickets: kind === 'crew' ? ['White Card'] : [], run: t.run_style === 'open' }]);
    setPhase('rate');
  }
  // Leaving the WHERE step. If they already picked a suggestion we have coords — go. Otherwise resolve
  // the typed address ourselves so a working address is never a dead end:
  //   • resolves          → pin it, continue
  //   • no match          → keep them here with a fix-it hint (don't ship a bad/unlocatable address)
  //   • geocoder is down  → continue anyway with the typed address (never trap the user behind our
  //                         own infrastructure; the crew still gets the written address)
  async function proceedWhere() {
    setErr('');
    if (coords) { setPhase('when'); return; }
    const q = loc.trim();
    if (q.length < 3) { setErr('Type the site address, or use your current location.'); return; }
    setResolving(true);
    try {
      const rs = await searchAddress(q, 1);
      if (rs && rs.length) { setLoc(rs[0].label); setCoords({ lat: rs[0].lat, lng: rs[0].lng }); setPhase('when'); }
      else { setErr("We couldn't find that address. Check the spelling, or tap “Use my current location” if you're on site."); }
    } catch (_) {
      setPhase('when');   // geocoder unavailable — proceed with the typed address rather than blocking
    } finally { setResolving(false); }
  }
  const setRateS = (tid, v) => setItems(items.map((i) => i.trade_id === tid ? { ...i, rate: Math.max(5, v) } : i));
  const bumpS = (tid, d) => setItems(items.map((i) => i.trade_id === tid ? { ...i, qty: Math.max(1, i.qty + d) } : i));
  const removeItemS = (tid) => setItems(items.filter((i) => i.trade_id !== tid));

  // Build a UTC ISO timestamp from the chosen LOCAL day-offset + hour (§6: store UTC).
  // new Date(y,m,d,h) constructs in the device's local zone; toISOString() serialises to UTC.
  function scheduledISO() {
    const base = new Date();
    base.setDate(base.getDate() + schedDay);
    base.setHours(schedHour, 0, 0, 0);
    return base.toISOString();
  }

  async function send() {
    setBusy(true); setErr('');
    try {
      const isBooked = when === 'scheduled';
      const sched = isBooked ? scheduledISO() : null;
      if (isBooked && new Date(sched) <= new Date()) { setErr('Pick a time in the future.'); setBusy(false); return; }
      const newId = await createRequest({ when_type: isBooked ? 'scheduled' : 'now', address_text: loc, lat: coords?.lat, lng: coords?.lng, duration_hours: duration, items, scheduled_for: sched, siteContact: { name: contactName, phone: contactPhone }, materialsCap: parseFloat(materialsCap) || 0, jobDetails, pickupText, travelCents: Math.round((parseFloat(travel) || 0) * 100) });
      // estimate for the pay sheet (server still computes the authoritative charge) — mirrors the
      // fee math: hourly items × the chosen hours, job-priced as-is, + travel. Passed through so the sheet never flashes $0.
      const estCents = items.reduce((s, it) => s + Math.round((Number(it.rate) || 0) * (Number(it.qty) || 1) * (it.priceMode === 'job' ? 1 : duration) * 100), 0) + Math.round((parseFloat(travel) || 0) * 100);
      const estLabel = tradeTitle(items[0]?.type) || 'Job';
      setPhase('sent');
      setTimeout(() => { onPosted && onPosted(newId, estCents, estLabel); }, 1100);   // let the "sent" beat land, then drop home
    } catch (e) { setErr(friendly ? friendly(e) : (e.message || 'Send failed')); setBusy(false); }
  }

  const cats = (tax?.categories) || [];
  // Merged first screen: ALL trades grouped by category across every door, each group carrying its
  // door's accent colour. Lets the client pick their trade in ONE screen instead of door→trade
  // (the door step was just a filter; the trade screen was already category-grouped). Research-backed
  // friction reduction — one genuinely redundant tap removed.
  // One clean list, shared with every other client posting surface (see
  // taxonomyService.clientPickerGroups) so the pickers can't drift: community
  // task/errand categories first under "Tasks & runs", then "Skilled trades & plant",
  // each category once.
  const allTradeGroups = clientPickerGroups(tax, { task: C.amber, skilled: C.indigo });
  // Picker v2: popular shortcuts + four collapsed folders (researched IA).
  const featured = featuredTrades(tax, 6);
  const folders = pickerFolders(tax, { task: C.amber, work: C.green, skilled: C.indigo, equipment: '#2C6E8F' });
  const pickHits = pickQ.trim() ? searchTrades(tax, pickQ) : [];
  const canSend = items.length > 0 && loc.trim();

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={[SH.host, { opacity: dim }]}>
      <Pressable style={SH.backdrop} onPress={() => { Keyboard.dismiss(); onClose(); }} />
      <KeyboardAvoidingView
        style={SH.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
      <Animated.View style={[SH.sheet, { transform: [{ translateY: y }] }]}>
        <View>
          <View style={SH.grab} />

          {/* PINNED HEADER — question + assembled answers stay put while options scroll */}
          {phase !== 'sent' && (
          <View style={SH.header}>
            {(() => {
              // Progress indicator (Baymard research: progress indicators produce larger gains than
              // changing form format). Shows the builder how far through posting they are — turns
              // "how long is this?" into "nearly there." Steps in order: what → pay → where → when → review.
              const STEPS = ['door', 'rate', 'where', 'when', 'review'];
              const pos = Math.max(0, STEPS.indexOf(phase));
              const frac = (pos + 1) / STEPS.length;
              return (
                <View style={SH.progressTrack}>
                  <View style={[SH.progressFill, { width: `${Math.round(frac * 100)}%` }]} />
                </View>
              );
            })()}
            {items.length > 0 && (
              <View style={{ marginBottom: 8 }}>
                {items.map((it) => (
                  <View key={it.trade_id} style={SH.itemChip}>
                    <Text style={SH.itemChipT}>{tradeTitle(it.type)}{it.qty > 1 ? ` ×${it.qty}` : ''} · ${it.rate}{it.priceMode === 'job' ? '/job' : '/hr'}</Text>
                    <TouchableOpacity onPress={() => removeItemS(it.trade_id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={SH.itemChipX}>✕</Text></TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            {phase !== 'where' && phase !== 'when' && loc ? (
              <TouchableOpacity style={SH.answered} onPress={() => setPhase('where')} activeOpacity={0.7}>
                <Text style={SH.answeredLabel}>WHERE</Text>
                <Text style={SH.answeredValue} numberOfLines={1}>{loc}</Text>
                <Text style={SH.answeredEdit}>edit</Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={SH.q}>{
                phase === 'door' ? 'What do you need?'
                : phase === 'rate' ? "How's the pay?"
                : phase === 'where' ? "Where's the site?"
                : phase === 'when' ? 'When do you need it?'
                : phase === 'sent' ? '' 
                : 'Ready to send?'
              }</Text>
              {/* back button on every step except the first (door) and the final sent screen, so
                  the client can move backward through the flow without leaving the sheet. */}
              {phase !== 'door' && phase !== 'sent' && (
                <TouchableOpacity
                  onPress={() => {
                    const prev = { rate: 'door', where: 'rate', when: 'where', review: 'when' };
                    setPhase(prev[phase] || 'door');
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={SH.back}>‹ back</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
          )}

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: phase === 'where' ? 320 : phase === 'review' ? 300 : 24, paddingTop: 4 }} style={{ height: SHEET_SCREEN_H * (phase === 'where' ? 0.56 : phase === 'review' ? 0.62 : 0.44) }}>

            <StepFade phase={phase}>
            {phase === 'door' && (
              <>
                {!tax ? <ActivityIndicator color={C.indigo} style={{ marginTop: 16 }} /> : (
                  <>
                    {/* Search — the escape hatch: type and every matching job surfaces, no folder-hunting */}
                    <View style={pk.searchWrap}>
                      <Icon name="search" size={16} color={C.mute} strokeWidth={2.2} />
                      <TextInput
                        style={pk.searchInput}
                        value={pickQ}
                        onChangeText={setPickQ}
                        placeholder="Search — e.g. traffic, cleaner, excavator"
                        placeholderTextColor={C.mute2}
                        autoCorrect={false}
                        returnKeyType="search"
                      />
                      {pickQ ? <TouchableOpacity onPress={() => setPickQ('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={pk.searchClear}>✕</Text></TouchableOpacity> : null}
                    </View>

                    {pickQ.trim() ? (
                      // SEARCH RESULTS — flat chips, no folders
                      pickHits.length === 0
                        ? <Text style={[SH.hint, { marginTop: 12 }]}>No match for “{pickQ.trim()}”. Try a simpler word.</Text>
                        : <View style={[SH.wrapChips, { marginTop: 14 }]}>
                            {pickHits.map((t) => (
                              <TouchableOpacity key={t.id} style={[SH.pick, { borderColor: C.indigo }]} onPress={() => pickTrade(t)} activeOpacity={0.75}>
                                <Text style={SH.pickT}>{tradeTitle(t.name)}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                    ) : (
                      <>
                        {/* POPULAR — the handful people pick most, one tap, always visible */}
                        {featured.length > 0 && (
                          <>
                            <Text style={pk.sectionT}>POPULAR</Text>
                            <View style={pk.featWrap}>
                              {featured.map((t) => (
                                <TouchableOpacity key={t.id} style={pk.featChip} onPress={() => pickTrade(t)} activeOpacity={0.85}>
                                  <Text style={pk.featChipT}>{tradeTitle(t.name)}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </>
                        )}

                        {/* BROWSE ALL — four folders, ALL collapsed by default (tap to open one) */}
                        <Text style={[pk.sectionT, { marginTop: 22 }]}>BROWSE ALL</Text>
                        {folders.map((f) => {
                          const isOpen = !!openCats[f.key];
                          return (
                            <View key={f.key} style={pk.folder}>
                              <TouchableOpacity onPress={() => setOpenCats((p) => ({ ...p, [f.key]: !isOpen }))} activeOpacity={0.7} style={pk.folderHead}>
                                <View style={[pk.folderDot, { backgroundColor: f.color }]} />
                                <View style={{ flex: 1 }}>
                                  <Text style={pk.folderTitle}>{f.label}<Text style={pk.folderCount}>  {f.trades.length}</Text></Text>
                                  <Text style={pk.folderSub}>{f.sub}</Text>
                                </View>
                                <Text style={[pk.folderChev, { transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }]}>›</Text>
                              </TouchableOpacity>
                              {isOpen && (
                                <View style={[SH.wrapChips, { marginTop: 4, marginBottom: 12 }]}>
                                  {f.trades.map((t) => (
                                    <TouchableOpacity key={t.id} style={[SH.pick, { borderColor: f.color }]} onPress={() => pickTrade(t)} activeOpacity={0.75}>
                                      <Text style={SH.pickT}>{tradeTitle(t.name)}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {phase === 'rate' && items.length > 0 && (
              <>
                <Text style={SH.hint}>Pre-filled to the going rate — tweak if you like.</Text>
                {items.slice(-1).map((it) => (
                  <View key={it.trade_id} style={SH.rateRow}>
                    <TouchableOpacity style={SH.rStep} onPress={() => setRateS(it.trade_id, it.rate - 5)}><Text style={SH.rStepT}>−</Text></TouchableOpacity>
                    <Text style={SH.rVal}>${it.rate}{it.priceMode === 'job' ? '/job' : '/hr'}</Text>
                    <TouchableOpacity style={SH.rStep} onPress={() => setRateS(it.trade_id, it.rate + 5)}><Text style={SH.rStepT}>＋</Text></TouchableOpacity>
                    {it.kind !== 'gear' && (
                      <View style={SH.qtyBox}>
                        <TouchableOpacity onPress={() => bumpS(it.trade_id, -1)}><Text style={SH.rStepT}>−</Text></TouchableOpacity>
                        <Text style={SH.qtyVal}>×{it.qty}</Text>
                        <TouchableOpacity onPress={() => bumpS(it.trade_id, 1)}><Text style={SH.rStepT}>＋</Text></TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
                <View style={SH.twoBtn}>
                  <TouchableOpacity style={SH.ghost} onPress={() => setPhase('door')}><Text style={SH.ghostT}>＋ Add another</Text></TouchableOpacity>
                  <TouchableOpacity style={SH.next} onPress={() => setPhase('where')}><Text style={SH.nextT}>Next ›</Text></TouchableOpacity>
                </View>
              </>
            )}

            {phase === 'where' && (
              <>
                {myLoc && (
                  <TouchableOpacity
                    style={SH.useLoc}
                    activeOpacity={0.8}
                    disabled={busy || locBusy}
                    onPress={async () => {
                      setLocBusy(true);
                      try {
                        const label = await reverseGeocode(myLoc.lat, myLoc.lng);
                        setLoc(label || 'Current location');
                        setCoords({ lat: myLoc.lat, lng: myLoc.lng });
                        setPhase('when');
                      } catch (_) {
                        setLoc('Current location');
                        setCoords({ lat: myLoc.lat, lng: myLoc.lng });
                        setPhase('when');
                      } finally { setLocBusy(false); }
                    }}>
                    {locBusy ? <ActivityIndicator color={C.indigo} size="small" />
                      : <><Text style={SH.useLocPin}>◎</Text><Text style={SH.useLocT}>Use my current location</Text><Text style={SH.useLocSub}>if you're at the site</Text></>}
                  </TouchableOpacity>
                )}
                {myLoc && <Text style={SH.orType}>or type an address</Text>}
                <AddressField value={loc} onChangeText={(t) => { setLoc(t); setCoords(null); setErr(''); }} onPick={(r) => { setLoc(r.label); setCoords({ lat: r.lat, lng: r.lng }); setErr(''); }} picked={!!coords} disabled={busy} />
                {!!err && phase === 'where' && (
                  <Text style={{ fontSize: 12.5, color: C.amber, fontWeight: '700', marginTop: 8 }}>{err}</Text>
                )}
                {loc.trim().length > 0 && !coords && !err && (
                  <Text style={{ fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 8 }}>Pick a suggestion, or just tap Next — we'll locate it for you.</Text>
                )}
                {/* Enabled as soon as an address is typed. proceedWhere() resolves coordinates itself
                    (picked → typed lookup → graceful continue) so a real address is never a dead end. */}
                <TouchableOpacity style={[SH.next, { marginTop: 16, opacity: (coords || loc.trim().length >= 3) ? 1 : 0.4 }]} disabled={(!coords && loc.trim().length < 3) || resolving} onPress={proceedWhere}>
                  {resolving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={SH.nextT}>Next ›</Text>}
                </TouchableOpacity>
              </>
            )}

            {phase === 'when' && (
              <>
                <TouchableOpacity style={[SH.opt, when === 'now' && SH.optOn]} onPress={() => { tap('light'); setWhen('now'); }}><Text style={[SH.optT, when === 'now' && SH.optTOn]}>Now — urgent</Text>{when === 'now' && <Text style={SH.optTick}>✓</Text>}</TouchableOpacity>
                <TouchableOpacity style={[SH.opt, when === 'scheduled' && SH.optOn]} onPress={() => { tap('light'); setWhen('scheduled'); }}><Text style={[SH.optT, when === 'scheduled' && SH.optTOn]}>Book ahead</Text>{when === 'scheduled' && <Text style={SH.optTick}>✓</Text>}</TouchableOpacity>
                {when === 'scheduled' && (
                  <View style={{ marginTop: 14 }}>
                    <Text style={SH.optionalLabel}>Which day</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {[0, 1, 2, 3, 4, 5, 6].map((off) => {
                        const d = new Date(); d.setDate(d.getDate() + off);
                        const lbl = off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric' });
                        return (
                          <TouchableOpacity key={off} style={[SH.dayChip, schedDay === off && SH.dayChipOn]} onPress={() => setSchedDay(off)}>
                            <Text style={[SH.dayChipT, schedDay === off && SH.dayChipTOn]}>{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                    <Text style={SH.optionalLabel}>Start time</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((h) => {
                        const lbl = h === 12 ? '12pm' : h > 12 ? `${h - 12}pm` : `${h}am`;
                        return (
                          <TouchableOpacity key={h} style={[SH.dayChip, schedHour === h && SH.dayChipOn]} onPress={() => setSchedHour(h)}>
                            <Text style={[SH.dayChipT, schedHour === h && SH.dayChipTOn]}>{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Expected hours — drives every pay estimate the worker sees. Only for hourly work
                    (job-priced runs are per-job, so duration doesn't apply). */}
                {items.some((it) => it.priceMode !== 'job') && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={SH.optionalLabel}>How long, roughly?</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                      {[2, 4, 6, 8, 10].map((h) => (
                        <TouchableOpacity key={h} style={[SH.dayChip, duration === h && SH.dayChipOn]} onPress={() => { tap('light'); setDuration(h); }}>
                          <Text style={[SH.dayChipT, duration === h && SH.dayChipTOn]}>{h === 10 ? 'Full day' : `${h} hrs`}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={[SH.optionalLabel, { marginTop: 8, fontWeight: '600', textTransform: 'none', letterSpacing: 0 }]}>Roughly — workers are paid for the hours actually worked.</Text>
                  </View>
                )}

                <TouchableOpacity style={[SH.next, { marginTop: 16 }]} onPress={() => setPhase('review')}><Text style={SH.nextT}>Review ›</Text></TouchableOpacity>
              </>
            )}

            {phase === 'review' && (
              <>
                <View style={SH.reviewCard}>
                  {items.map((it) => (
                    <View key={it.trade_id} style={SH.reviewRow}><Text style={SH.reviewName}>{tradeTitle(it.type)}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text><Text style={SH.reviewRate}>${it.rate}{it.priceMode === 'job' ? '/job' : '/hr'}</Text></View>
                  ))}
                  <View style={SH.reviewDiv} />
                  <View style={SH.reviewRow}><Text style={SH.reviewMeta}>{loc || 'No location'}</Text></View>
                  <View style={SH.reviewRow}><Text style={SH.reviewMeta}>{when === 'now' ? 'Now — urgent' : (() => { const d = new Date(); d.setDate(d.getDate() + schedDay); d.setHours(schedHour, 0, 0, 0); return 'Booked · ' + d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) + ' at ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); })()}</Text></View>
                  {/* Estimated total for the chosen hours — the real number, not a fixed 4h */}
                  {(() => {
                    const hourly = items.some((i) => i.priceMode !== 'job');
                    const est = items.reduce((s, it) => s + (Number(it.rate) || 0) * (Number(it.qty) || 1) * (it.priceMode === 'job' ? 1 : duration), 0) + (parseFloat(travel) || 0);
                    return (
                      <>
                        <View style={SH.reviewDiv} />
                        <View style={SH.reviewRow}>
                          <Text style={SH.reviewName}>Estimated total{hourly ? ` · ${duration === 10 ? 'full day' : duration + 'h'}` : ''}</Text>
                          <Text style={SH.reviewRate}>~${Math.round(est).toLocaleString()}</Text>
                        </View>
                      </>
                    );
                  })()}
                </View>
                {!!err && <Text style={SH.err}>{err}</Text>}

                {/* The ONE field that matters — what the worker will actually do (they read it before
                    accepting). Everything else is opt-in below, so this isn't a wall of empty boxes. */}
                <Text style={SH.optionalLabel}>What's the job? <Text style={SH.optionalHint}>(workers read this before accepting)</Text></Text>
                <TextInput
                  style={[SH.optionalInput, { minHeight: 76, textAlignVertical: 'top', paddingTop: 10 }]}
                  value={jobDetails}
                  onChangeText={(t) => setJobDetails(t.slice(0, 300))}
                  placeholder="e.g. Directing traffic at the north entrance from 6am. Hi-vis and own boots."
                  placeholderTextColor={C.mute2}
                  multiline
                  maxLength={300}
                />

                {/* Optional extras — tap only what's relevant. Materials/pickup appear only for runs. */}
                {(() => {
                  const runJob = items.some((i) => i.run);
                  const chips = [
                    { key: 'contact', label: 'Site contact', has: !!(contactName || contactPhone) },
                    { key: 'travel', label: 'Travel allowance', has: !!travel },
                    runJob && { key: 'pickup', label: 'Where to buy', has: !!pickupText },
                    runJob && { key: 'materials', label: 'Materials budget', has: !!materialsCap },
                  ].filter(Boolean);
                  const open = (k) => !!openAddons[k];
                  return (
                    <>
                      <Text style={[SH.optionalLabel, { marginTop: 18 }]}>Add more <Text style={SH.optionalHint}>(optional)</Text></Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                        {chips.map((c) => {
                          const on = open(c.key) || c.has;
                          return (
                            <TouchableOpacity key={c.key} onPress={() => { tap('light'); setOpenAddons((p) => ({ ...p, [c.key]: !on })); }}
                              style={[SH.addChip, on && SH.addChipOn]} activeOpacity={0.85}>
                              <Text style={[SH.addChipT, on && SH.addChipTOn]}>{on ? '✓ ' : '＋ '}{c.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {(open('contact') || !!(contactName || contactPhone)) && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={SH.optionalHint}>Who to ask for on site</Text>
                          <TextInput style={SH.optionalInput} value={contactName} onChangeText={setContactName} placeholder="Name on site" placeholderTextColor={C.mute2} />
                          <TextInput style={SH.optionalInput} value={contactPhone} onChangeText={setContactPhone} placeholder="Their phone" placeholderTextColor={C.mute2} keyboardType="phone-pad" />
                        </View>
                      )}
                      {(open('travel') || !!travel) && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={SH.optionalHint}>Paid 100% to the worker · ATO guide 88c/km (a 20km round trip ≈ $18)</Text>
                          <TextInput style={SH.optionalInput} value={travel} onChangeText={setTravel} placeholder="$ toward their travel" placeholderTextColor={C.mute2} keyboardType="decimal-pad" />
                        </View>
                      )}
                      {runJob && (open('pickup') || !!pickupText) && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={SH.optionalHint}>Which shop — so they know where to go</Text>
                          <TextInput style={SH.optionalInput} value={pickupText} onChangeText={(t) => setPickupText(t.slice(0, 120))} placeholder="e.g. Bunnings Alexandria" placeholderTextColor={C.mute2} />
                        </View>
                      )}
                      {runJob && (open('materials') || !!materialsCap) && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={SH.optionalHint}>A cap you'll cover for parts they buy</Text>
                          <TextInput style={SH.optionalInput} value={materialsCap} onChangeText={setMaterialsCap} placeholder="$0 cap" placeholderTextColor={C.mute2} keyboardType="decimal-pad" />
                        </View>
                      )}
                    </>
                  );
                })()}

                <TouchableOpacity style={[SH.send, !canSend && { opacity: 0.4 }]} disabled={!canSend || busy} onPress={send}><Text style={SH.sendT}>{busy ? 'Sending…' : 'Post job →'}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setPhase('when')} style={{ marginTop: 12, alignItems: 'center' }}><Text style={SH.back}>‹ back</Text></TouchableOpacity>
              </>
            )}

            {phase === 'sent' && (
              <View style={{ alignItems: 'center', paddingVertical: 30 }}>
                <View style={SH.sentCheck}><Text style={SH.sentCheckT}>✓</Text></View>
                <Text style={SH.sentT}>Request sent</Text>
                <Text style={SH.sentSub}>Finding workers near your site…</Text>
              </View>
            )}
            </StepFade>
          </ScrollView>
        </View>
      </Animated.View>
      </KeyboardAvoidingView>
    </Animated.View>
    </Modal>
  );
}


// TrackerContainer — fetches + live-subscribes the unified tracker state for one job and
// renders the LiveTrackerCard. Self-contained so it drops in anywhere a job is active.
// Polls lightly (for ETA drift while en_route) AND reacts to realtime row changes — belt
// and braces, since ETA moves continuously but row-changes fire on state transitions.
function TrackerContainer({ requestId, onAction, perspective = 'client' }) {
  const [state, setState] = useState(null);
  const aliveRef = useRef(true);
  const refresh = React.useCallback(async () => {
    if (!requestId) return;
    try { const s = await getTrackerState(requestId, perspective); if (aliveRef.current) setState(s); } catch (_) {}
  }, [requestId, perspective]);

  useEffect(() => { aliveRef.current = true; refresh(); return () => { aliveRef.current = false; }; }, [refresh]);
  useRealtime(['assignments', 'requests'], refresh);
  // light poll so a moving worker's ETA/progress stays fresh even without a row change.
  // While FINDING (crew still assembling), poll fast (5s) so spots visibly trickle in one-by-one;
  // once en_route, 15s is plenty for ETA drift.
  useEffect(() => {
    if (!state || !['en_route', 'finding'].includes(state.stage)) return;
    const everyMs = state.stage === 'finding' ? 5000 : 15000;
    const t = setInterval(refresh, everyMs);
    return () => clearInterval(t);
  }, [state?.stage, refresh]);

  if (!state || !state.exists) return null;
  return <LiveTrackerCard state={state} onAction={onAction} />;
}

// ── Shared client payment flow (Stripe test mode) ────────────────────────────
// Post a job → authorise a hold (money isn't taken yet); approve the work → capture + pay the
// worker. Extracted so EVERY client posting/approval surface (Home map, Requests tab) drives
// payment through the SAME code. Previously only ClientHome was wired, so the primary "Post a job"
// action — which routes through goPost() to the Requests tab — silently skipped Stripe entirely.
//   getReq(id)      → the request object (with request_items + assignments) for estimates/rating
//   reload()        → refresh the caller's list after a state change
//   onRateReady(rp) → the caller shows its rating prompt once the pay sheet closes
//   onError(e, id)  → the caller surfaces + logs an approval failure
function useClientPayFlow({ getReq, reload, onRateReady, onError }) {
  const [payReq, setPayReq] = useState(null);        // { id, label, estimateCents, adj?, approve? }
  const [pendingRate, setPendingRate] = useState(null);

  function estimateCentsFor(req) {
    const hrs = req?.duration_hours || 4;
    let cents = 0;
    for (const it of (req?.request_items || [])) {
      const rate = Number(it.rate) || 0, qty = Number(it.qty) || 1;
      cents += Math.round(rate * qty * (it.price_mode === 'job' ? 1 : hrs) * 100);
    }
    cents += Number(req?.travel_cents) || 0;   // travel is part of the total the client pays
    return cents;
  }

  // Guard: never open a payment for a job no worker is on. A request must have at least one
  // assignment in a live/finished state before any money can move (matches the server settle rule).
  const WORKER_STATES = ['committed', 'accepted', 'en_route', 'on_site', 'complete', 'approved'];
  const DONE_STATES = ['complete', 'approved'];
  function reqHasWorker(req, states) {
    return (req?.request_items || []).some((it) => (it.assignments || []).some((a) => a.operator_id && states.includes(a.status)));
  }

  // Pay → open the pay sheet. Only valid once a worker is actually on the job (never on a fresh post).
  function payJob(reqId, estOverride, labelOverride) {
    const req = getReq(reqId);
    if (!reqHasWorker(req, WORKER_STATES)) { onError && onError(new Error('No one has taken this job yet — you pay once a worker has done the work.'), reqId); return; }
    const est = Number(estOverride) > 0 ? Number(estOverride) : estimateCentsFor(req);
    const label = labelOverride || req?.request_items?.[0]?.type || 'Job';
    setPayReq({ id: reqId, label, estimateCents: est });
  }
  // Approve → open the pay sheet in auto-capture mode. Only valid once a worker has COMPLETED the job.
  function beginApproval(reqId, adj) {
    const req = getReq(reqId);
    if (!reqHasWorker(req, DONE_STATES)) { onError && onError(new Error('You can approve & pay once a worker has completed the job.'), reqId); return; }
    setPayReq({ id: reqId, label: req?.request_items?.[0]?.type || 'Job', estimateCents: estimateCentsFor(req), adj, approve: true });
  }
  // Runs AFTER the Stripe capture succeeds. Settlement already ran BEFORE capture (see beforeCapture
  // on the PaySheet) so the worker is paid EXACTLY the DB-settled net_amount — here we only refresh
  // and queue the rating.
  async function finalizePaidApproval(reqId, adj) {
    try {
      const req = getReq(reqId);
      let assignmentId = null, rateeName = null;
      for (const it of (req?.request_items || [])) {
        for (const a of (it.assignments || [])) {
          if (['complete', 'approved'].includes(a.status) && a.operator_id) { assignmentId = a.id; rateeName = a.operator?.full_name || 'the operator'; break; }
        }
        if (assignmentId) break;
      }
      await reload();
      if (assignmentId) setPendingRate({ assignmentId, rateeName });
    } catch (e) { onError && onError(e, reqId); }
  }

  const PaySheet = (
    <PayJobSheet
      visible={!!payReq}
      requestId={payReq?.id}
      label={payReq?.label}
      estimateCents={payReq?.estimateCents}
      autoCapture={!!payReq?.approve}
      beforeCapture={payReq?.approve ? (() => approveRequest(payReq.id, payReq.adj)) : undefined}
      onPaid={() => { if (payReq?.approve) finalizePaidApproval(payReq.id, payReq.adj); else reload(); }}
      onClose={() => { setPayReq(null); if (pendingRate) { onRateReady && onRateReady(pendingRate); setPendingRate(null); } }}
    />
  );

  return { payReq, payJob, beginApproval, PaySheet };
}

function ClientHome({ session, onPost, onOpenReq, onOpenProfile, onScroll }) {
  const [mine, setMine] = useState(() => cacheGet('client-requests'));   // shared cache → instant paint
  const [mapJobs, setMapJobs] = useState([]);
  const [myLoc, setMyLoc] = useState(null);
  const [unread, setUnread] = useState({});
  const [chat, setChat] = useState(null);   // { a, title, sub } — the open job room
  const [ratePrompt, setRatePrompt] = useState(null);  // { assignmentId, rateeName } post-approve
  const [reviewReq, setReviewReq] = useState(null);    // request under review-before-approve
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [activeNow, setActiveNow] = useState(null);
  const [coverage, setCoverage] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const load = useCallback(async () => {
    try { const d = await listMyRequestsFull(); setMine(d); cacheSet('client-requests', d); } catch (e) { setMine((p) => (p == null ? [] : p)); }
    try { setMapJobs(await getMapJobs()); } catch (_) { /* map just shows empty */ }
    try { setUnread(await getUnreadCounts(session.user.id)); } catch (_) {}
    try { const s = await getPulseStats(); setActiveNow(s?.active_now ?? null); } catch (_) {}
  }, [session.user.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // unread badge stays fresh even without other realtime events
    const t = setInterval(async () => { try { setUnread(await getUnreadCounts(session.user.id)); } catch (_) {} }, 10000);
    return () => clearInterval(t);
  }, [session.user.id]);
  useEffect(() => { (async () => { try { const p = await getPosition(); setMyLoc({ lat: p.lat, lng: p.lng }); } catch (_) {} })(); }, []);
  useEffect(() => {
    if (!myLoc) return;
    let alive = true;
    (async () => { try { const c = await getOperatorCoverage(myLoc.lat, myLoc.lng, 25); if (alive) setCoverage(c); } catch (_) {} })();
    return () => { alive = false; };
  }, [myLoc]);
  // REAL demand heat — where active jobs actually are right now (anonymised coords).
  const [demand, setDemand] = useState(null);
  useEffect(() => {
    if (!myLoc) return;
    let alive = true;
    (async () => { try { const d = await getDemandHeat(myLoc.lat, myLoc.lng, 40); if (alive) setDemand(d); } catch (_) {} })();
    return () => { alive = false; };
  }, [myLoc, mapJobs]);
  useRealtime(['assignments', 'requests'], load);
  const active = (mine || []).filter((r) => !['complete', 'cancelled'].includes(r.status));
  // split: jobs that NEED the client (ready to approve) vs jobs just progressing
  const needsYou = active.filter((r) => statusMeta(r).bucket === 'ready');
  const progressing = active.filter((r) => statusMeta(r).bucket !== 'ready');
  // THE MATCH — the most relevant job with workers on it (one card per JOB, not
  // per worker). Gather the whole crew so a multi-spot job reads as one thing.
  let match = null;
  for (const r of active) {
    const crew = [];
    let needed = 0;
    let primaryItem = null;
    for (const it of (r.request_items || [])) {
      needed += (it.qty || 1);
      for (const a of (it.assignments || [])) {
        // include completed/approved too — otherwise a finished worker VANISHES from the crew
        // roster and the count regresses ("2 of 3" drops back to "1 of 3"). The whole crew stays visible.
        if (['committed', 'accepted', 'en_route', 'on_site', 'complete', 'approved'].includes(a.status) && a.operator) {
          crew.push({ a, it });
          if (!primaryItem) primaryItem = it;
        }
      }
    }
    if (crew.length > 0) { match = { r, crew, needed, it: primaryItem }; break; }
  }
  const [sheetOpen, setSheetOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);   // reserved for future one-tap templates
  const openPost = () => { setPrefill(null); setSheetOpen(true); };
  // When there's active work the sheet is a tall, scrollable panel (fixed peek). When there ISN'T,
  // the sheet HUGS its content and sits right above the tab bar — no dead gap, map fills the rest.
  const hasActiveWork = active.length > 0;
  // When a job is waiting to be paid, THAT is the hero — so the post CTA recedes to a quiet
  // bar (only one loud element at a time). Otherwise "Post a job" is the loud hero.
  const payMode = needsYou.length > 0;
  // hub list for the full-screen command centre — track & act without leaving
  const STATUS_WORDS = { getting_ready: 'Getting ready', on_the_way: 'On the way', on_site: 'On site', done: 'Complete', waiting: 'Finding workers' };
  const DOT = { getting_ready: C.mute, on_the_way: C.indigo, on_site: C.green, done: C.green, waiting: C.red };
  const hubJobs = (mapJobs || []).map((j) => {
    const isReady = j.status === 'done' || (j.assignedStatus === 'complete');
    return {
      id: j.requestId,
      title: j.label || 'Your job',
      sub: `${j.sub || 'Job'} · ${STATUS_WORDS[j.status] || 'Active'}`,
      dotColor: DOT[j.status] || C.mute,
      action: j.assignedName ? 'Message' : (j.status === 'done' ? 'Review' : 'View'),
      _raw: j,
      // in-centre detail sheet — info + actions, all over the map
      detail: {
        rows: [
          j.crewSize > 1 ? { k: 'Crew', v: j.crewSummary || `Crew of ${j.crewSize}` }
            : j.assignedName ? { k: 'Worker', v: j.assignedName } : null,
          { k: 'Status', v: STATUS_WORDS[j.status] || 'Active' },
          j.sub ? { k: 'Job', v: j.sub } : null,
        ].filter(Boolean),
        actions: [
          isReady ? { label: 'Review & pay', tone: 'green', fn: () => openReview(j.requestId) } : null,
          j.assignedName ? { label: j.crewSize > 1 ? 'Message crew' : `Message ${j.assignedName.split(' ')[0]}`, tone: 'ready', closesMap: true, fn: () => messageForRaw(j) } : null,
          j.status !== 'done' ? { label: 'Re-post to pool', tone: 'ghost', fn: () => repost(j.requestId) } : null,
          j.status !== 'done' ? { label: 'Cancel job', tone: 'danger', fn: () => cancel(j.requestId) } : null,
        ].filter(Boolean),
      },
    };
  });
  const messageForRaw = (raw) => {
    if (raw.assignedName && match && match.r.id === raw.id) {
      const trav = (match.crew || []).find((x) => x.a.status === 'en_route') || (match.crew || [])[0];
      if (trav) { setChat({ a: trav.a, title: `${(trav.a.operator?.full_name || 'Worker').split(' ')[0]} · ${trav.it.type}`, sub: `${suburbOf(match.r.address_text)} · ${STATUS_WORDS[raw.status] || ''}`, info: buildJobInfo({ a: trav.a, it: trav.it, r: match.r }) }); return; }
    }
    if (onOpenReq) onOpenReq(raw.id);
  };
  // approve / cancel / repost live HERE too (ClientHome's map detail sheet uses
  // them) — same services as ClientRequests, this component's own handlers.
  // C1: tapping "Approve & pay" now opens the review sheet first, not immediate settlement.
  function openReview(reqId) {
    const req = (mine || []).find((r) => r.id === reqId);
    if (req) setReviewReq(req);
  }
  // Approval IS the payment: reviewing → confirm opens the pay sheet (auto-captures + pays the
  // worker). All the Stripe wiring lives in useClientPayFlow so Home and the Requests tab behave
  // identically. beginApproval opens the sheet; the sheet finalises the approval once captured.
  const { payJob, beginApproval, PaySheet } = useClientPayFlow({
    getReq: (id) => (mine || []).find((r) => r.id === id),
    reload: load,
    onRateReady: setRatePrompt,
    onError: (e, id) => { setMsg('Approve failed: ' + friendly(e)); logError('approve', e, { correlationId: id, appContext: 'client' }); },
  });

  // Approval → Stripe capture runs through useClientPayFlow (beginApproval), same as the Requests tab.
  async function cancel(reqId) {
    setBusy(true); setMsg('');
    try { await cancelRequest(reqId); await load(); setMsg('Job cancelled — you haven’t been charged, and any card hold has been released.'); } catch (e) { setMsg('Cancel failed: ' + friendly(e)); logError('cancel', e, { correlationId: reqId, appContext: 'client' }); } finally { setBusy(false); }
  }
  async function repost(reqId) {
    setBusy(true); setMsg('');
    try { await repostRequest(reqId); await load(); } catch (e) { setMsg('Re-post failed: ' + friendly(e)); } finally { setBusy(false); }
  }
  const onHubAction = (j) => messageForRaw(j._raw);
  return (
    <View style={{ flex: 1 }}>
    {/* IMMERSIVE HOME — full-bleed living map behind a floating content sheet */}
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <MapHero
        height={Dimensions.get('window').height} framed={false} markers={mapJobs} me={myLoc} activeNow={activeNow} coverage={coverage} demand={demand} mode="hire"
        hubJobs={hubJobs} onHubAction={onHubAction} onPostFromMap={(r) => { if (r && r.posted) { load(); } else { setSheetOpen(true); } }}
        commandSummary={active.length > 0 ? `${active.length} active${needsYou.length ? ` · ${needsYou.length} needs you` : ''}` : (coverage && coverage.n > 0 ? `${coverage.n} worker${coverage.n === 1 ? '' : 's'} nearby` : 'All clear')}
        chatBubble={match ? { unread: 0, fn: () => { const trav = (match.crew || []).find((x) => x.a.status === 'en_route') || (match.crew || [])[0]; if (trav) setChat({ a: trav.a, title: `${(trav.a.operator?.full_name || 'Worker').split(' ')[0]} · ${trav.it.type}`, sub: `${suburbOf(match.r.address_text)}`, info: buildJobInfo({ a: trav.a, it: trav.it, r: match.r }) }); } } : null}
        onWorkerTap={(requestId) => {
          // Solo job → tapping the worker's badge opens a direct chat with them (makes sense).
          // CREW job → "tap for details" must open the JOB, not DM one random crew member.
          const crewSize = (match && match.r.id === requestId) ? (match.crew || []).length : 0;
          if (match && match.r.id === requestId && crewSize <= 1) {
            const trav = (match.crew || []).find((x) => x.a.status === 'en_route') || (match.crew || [])[0];
            if (trav) {
              setChat({
                a: trav.a,
                title: `${(trav.a.operator?.full_name || 'Worker').split(' ')[0]} · ${trav.it.type}`,
                sub: `${suburbOf(match.r.address_text)} · on the way`,
                info: buildJobInfo({ a: trav.a, it: trav.it, r: match.r }),
              });
              return;
            }
          }
          if (onOpenReq) onOpenReq(requestId);
        }}
      />
    </View>
    {/* subtle "?" help button floating on the map (replaces the sheet pill — keeps the sheet tight) */}
    <TouchableOpacity onPress={() => setHelpOpen(true)} activeOpacity={0.8}
      style={{ position: 'absolute', top: 14, left: 16, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(18,18,26,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="help" size={19} color="rgba(255,255,255,0.9)" strokeWidth={2.2} />
    </TouchableOpacity>
    {/* floating content sheet — HUGS its content when quiet (sits just above the tab bar, no dead
        gap, map fills the rest) and rises into a scrollable panel when there's active work. */}
    {(() => {
      const brandNew = mine !== null && (mine || []).length === 0;
      const sheetChrome = { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 26, shadowOffset: { width: 0, height: -10 }, elevation: 14 };
      // PINNED ANCHOR — the post-a-job hero + one centred helper pill. Always the same height, so the
      // hugging sheet lands in a predictable spot on every device.
      const pinnedHeader = (
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 }}>
          <TouchableOpacity onPress={openPost} activeOpacity={0.9}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.panel, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16.5, fontWeight: '800', letterSpacing: -0.3, color: C.ink }}>Who do you need on site?</Text>
              <Text style={{ fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 3 }}>Post a job — crews nearby are notified instantly</Text>
            </View>
            <View style={{ width: 50, height: 50, borderRadius: 15, backgroundColor: C.indigo, alignItems: 'center', justifyContent: 'center', shadowColor: C.indigo, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }}>
              <Text style={{ color: '#fff', fontSize: 27, marginTop: -2 }}>＋</Text>
            </View>
          </TouchableOpacity>
          {/* "How it works" moved to a subtle ? button ON the map (see below) — the sheet stays tight. */}
          {brandNew && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 }}>
              <LiveTag />
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.ink }}>
                {coverage && coverage.n > 0 ? `${coverage.n} ${coverage.n === 1 ? 'crew' : 'crews'} available near you` : 'Crews across Sydney, ready to mobilise'}
              </Text>
            </View>
          )}
        </View>
      );
      // QUIET — hug the content, sit just above the tab bar (paddingBottom clears the island).
      if (!hasActiveWork) {
        return <View style={[sheetChrome, { paddingBottom: 80 }]}>{pinnedHeader}</View>;
      }
      // ACTIVE — a taller panel with a scrollable body holding the live work.
      return (
        <View style={[sheetChrome, { top: '42%' }]}>
          {pinnedHeader}
          <Animated.ScrollView style={{ flex: 1 }} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={{ paddingBottom: 130, paddingHorizontal: 16, paddingTop: 2 }}>
            {(() => {
              const trackedId = (match && match.r.id) || (active[0] && active[0].id);
              if (!trackedId) return null;
              return <TrackerContainer requestId={trackedId} onAction={(action, arg) => {
                if (action === 'open_review' && onOpenReq) onOpenReq(trackedId);
                else if (action === 'open_profile' && arg && onOpenProfile) onOpenProfile(arg);
                else if (action === 'open_chat') {
                  const m = match && match.r.id === trackedId ? match : null;
                  const trav = m ? ((m.crew || []).find((x) => x.a.status === 'en_route') || (m.crew || [])[0]) : null;
                  if (trav) setChat({ a: trav.a, title: `${(trav.a.operator?.full_name || 'Worker').split(' ')[0]} · ${trav.it.type}`, sub: suburbOf(m.r.address_text), info: buildJobInfo({ a: trav.a, it: trav.it, r: m.r }) });
                  else if (onOpenReq) onOpenReq(trackedId);
                }
                else if (action === 'open_help') setHelpOpen(true);
              }} />;
            })()}
            <View style={{ paddingTop: 8 }}>
              {match && (
                <Entrance key={match.r.id}>
                  <MatchCard
                    r={match.r} crew={match.crew} needed={match.needed}
                    unread={unread}
                    showMessage={false}
                    onOpenProfile={onOpenProfile}
                    onOpen={() => onOpenReq && onOpenReq(match.r.id)}
                    onMessageWorker={(a, it) => setChat({
                      a,
                      title: `${(a.operator?.full_name || 'Worker').split(' ')[0]} · ${it.type}`,
                      sub: `${suburbOf(match.r.address_text)} · ${a.status === 'en_route' ? 'on the way' : a.status === 'on_site' ? 'on site' : 'committed'}`,
                      info: buildJobInfo({ a, it, r: match.r }),
                    })}
                  />
                </Entrance>
              )}
              {needsYou.length > 0 && (
                <View style={{ marginBottom: 24 }}>
                  <Text style={[T.eyebrow, { marginBottom: 8 }]}>Needs you</Text>
                  {needsYou.map((r) => <NeedsYouCard key={r.id} r={r} onOpen={() => onOpenReq && onOpenReq(r.id)} />)}
                </View>
              )}
              {(() => {
                const rest = progressing.filter((r) => !match || r.id !== match.r.id);
                return (
                  <>
                    {rest.length > 0 && (
                      <>
                        <View style={S_.rowBetween}>
                          <Text style={T.eyebrow}>Active now</Text>
                          <LiveTag />
                        </View>
                        {rest.slice(0, 4).map((r) => <MiniReqCard key={r.id} r={r} onOpen={() => onOpenReq && onOpenReq(r.id)} />)}
                      </>
                    )}
                    <View style={{ alignItems: 'center', marginTop: 28, paddingVertical: 8 }}>
                      <Text style={{ fontSize: 12.5, color: C.mute, fontWeight: '600', letterSpacing: 0.2 }}>You're all caught up</Text>
                    </View>
                  </>
                );
              })()}
            </View>
          </Animated.ScrollView>
        </View>
      );
    })()}
    <RequestSheet
      visible={sheetOpen}
      onClose={() => { setSheetOpen(false); setPrefill(null); }}
      myLoc={myLoc}
      prefill={prefill}
      onPosted={async (id, est, label) => { setSheetOpen(false); setPrefill(null); await load(); setMsg('Job posted — crews nearby are being notified. You pay only once the work is done.'); }}
    />
    <HelpCenter visible={helpOpen} onClose={() => setHelpOpen(false)} role="client" />
    {PaySheet}
    <JobChat
      visible={!!chat}
      onClose={() => { setChat(null); load(); }}
      assignmentId={chat?.a?.id}
      meId={session.user.id}
      title={chat?.title}
      subtitle={chat?.sub}
      jobInfo={chat?.info}
      peerId={chat?.a?.operator_id}
      onOpenProfile={onOpenProfile}
    />
    <RateJob
      visible={!!ratePrompt}
      assignmentId={ratePrompt?.assignmentId}
      rateeName={ratePrompt?.rateeName}
      onClose={() => setRatePrompt(null)}
    />
    <ReviewApprove
      visible={!!reviewReq}
      request={reviewReq}
      onClose={() => setReviewReq(null)}
      onConfirm={(adj) => { const id = reviewReq.id; setReviewReq(null); beginApproval(id, adj); }}
    />
    </View>
  );
}

/* A job that needs the client's action — loud, high-contrast, one clear CTA. */
function NeedsYouCard({ r, onOpen }) {
  const items = r.request_items || [];
  const suburb = (r.address_text || 'No location').split(',')[0];
  const summary = items.map((it) => it.qty > 1 ? `${tradeTitle(it.type)} ×${it.qty}` : tradeTitle(it.type)).join(' · ');
  return (
    <TouchableOpacity style={S_.needsCard} onPress={onOpen} activeOpacity={0.85}>
      <View style={{ flex: 1 }}>
        <Text style={S_.needsSuburb} numberOfLines={1}>{suburb}</Text>
        <Text style={S_.needsSummary} numberOfLines={1}>{summary}</Text>
        <Text style={S_.needsStatus}>Work done · ready to approve & pay</Text>
      </View>
      <View style={S_.needsCta}><Text style={S_.needsCtaT}>Review ›</Text></View>
    </TouchableOpacity>
  );
}

/* ============================================================ CLIENT · REQUESTS (wizard + list) */

// Requests tab: collapse the 7 status buckets into 3 client-facing groups. Each card's pill still
// shows the exact status (open/filling/filled/…), so nothing is lost — the filter just answers the
// only question a client asks: is it live, does it need me, or is it done?
const REQ_GROUP = { open: 'active', filling: 'active', filled: 'active', ready: 'ready', complete: 'past', cancelled: 'past' };
const reqGroupOf = (r) => REQ_GROUP[statusMeta(r).bucket] || 'active';

// real 2026 AU award-guided rates: [floor, lo, hi] $/hr (task = $/job)
const RATES = {
  'Excavator': [90, 110, 140], 'Line pump': [150, 180, 240], 'Dozer': [130, 160, 200],
  'Tipper': [95, 120, 160], 'Mobile crane': [200, 250, 340], 'Water cart': [90, 110, 150],
  'Labourer': [32, 40, 52], 'Traffic controller': [32, 38, 46], 'Machine operator': [42, 55, 72],
  'Dogman / rigger': [48, 60, 80], 'Spotter': [35, 45, 58], 'Concreter': [45, 58, 78],
  'Bunnings pickup': [25, 30, 45], 'Parts run': [25, 30, 45], 'Bin / tip run': [40, 50, 70], 'Materials drop': [30, 40, 60],
};

function ClientRequests({ session, openNew, onOpenedNew, focusReq, onFocused }) {
  const [mode, setMode] = useState('list');       // list | new | searching
  const [step, setStep] = useState(1);
  const [searchReq, setSearchReq] = useState(null);   // { id, summary } after a post
  const [filter, setFilter] = useState('active');
  const [items, setItems] = useState([]);
  const [picker, setPicker] = useState(false);   // TradePicker open?
  const [loc, setLoc] = useState('');
  const [coords, setCoords] = useState(null); // { lat, lng } from picked address
  const [when, setWhen] = useState('now');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState(null);   // which request's action is running (per-card spinner)
  const [msg, setMsg] = useState('');
  const [mine, setMine] = useState(() => cacheGet('client-requests'));   // instant paint from last load, or null → spinner
  const [ratePrompt, setRatePrompt] = useState(null);   // { assignmentId, rateeName } post-approve
  const [reviewReq, setReviewReq] = useState(null);     // request under review-before-approve
  const [sheetOpen, setSheetOpen] = useState(false);   // unified request sheet (same as home)

  const load = useCallback(async () => {
    try { const d = await listMyRequestsFull(); setMine(d); cacheSet('client-requests', d); }
    catch (e) { setMine((prev) => (prev == null ? [] : prev)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime(['assignments', 'requests'], load);
  const [refreshing, setRefreshing] = useState(false);
  const onPull = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  // Same Stripe flow as Home — posting authorises a hold, approving captures + pays the worker.
  const { payJob, beginApproval, PaySheet } = useClientPayFlow({
    getReq: (id) => (mine || []).find((r) => r.id === id),
    reload: load,
    onRateReady: setRatePrompt,
    onError: (e, id) => { setMsg('Approve failed: ' + friendly(e)); logError('approve', e, { correlationId: id, appContext: 'client' }); },
  });

  function startNew() { setItems([]); setLoc(''); setWhen('now'); setStep(1); setMode('new'); }

  // jumped here from the home "Need something on site?" button — open the flow directly
  useEffect(() => {
    if (openNew) { setSheetOpen(true); onOpenedNew && onOpenedNew(); }
  }, [openNew]);

  // jumped here by tapping an "Active now" card — show the list, filter to that
  // job's bucket (so it's isolated + its action is in view), and expand it.
  useEffect(() => {
    if (focusReq) {
      setMode('list');
      const target = (mine || []).find((r) => r.id === focusReq);
      if (target) setFilter(reqGroupOf(target));
      const t = setTimeout(() => onFocused && onFocused(), 1500);
      return () => clearTimeout(t);
    }
  }, [focusReq, mine]);
  function addTrade(trade) {
    // map a picked taxonomy trade -> a wizard item.
    // keep `type` = trade name so existing display logic keeps working;
    // carry trade_id so we can save the real taxonomy link.
    const legacyKind = trade.kind === 'plant' ? 'gear' : trade.kind; // 'gear' keeps old gear behaviour (no qty bump, wet hire)
    const ex = items.find((i) => i.trade_id === trade.id);
    if (ex) {
      if (legacyKind !== 'gear') setItems(items.map((i) => i.trade_id === trade.id ? { ...i, qty: i.qty + 1 } : i));
    } else {
      const presetRate = RATES[trade.name] ? RATES[trade.name][1] : (legacyKind === 'task' ? 40 : 55);
      setItems([...items, {
        trade_id: trade.id,
        kind: legacyKind,
        type: trade.name,
        qty: 1,
        rate: presetRate,
        priceMode: legacyKind === 'task' ? 'job' : 'hour',   // task = fixed $/job, else $/hr
        tickets: legacyKind === 'crew' ? ['White Card'] : [],
      }]);
    }
    setPicker(false);
  }
  const removeItem = (tid) => setItems(items.filter((i) => i.trade_id !== tid));
  const bump = (tid, d) => setItems(items.map((i) => i.trade_id === tid ? { ...i, qty: Math.max(1, i.qty + d) } : i));
  const setRate = (tid, v) => setItems(items.map((i) => i.trade_id === tid ? { ...i, rate: v } : i));

  async function post() {
    setBusy(true); setMsg('');
    try {
      const id = await createRequest({ when_type: when, address_text: loc, lat: coords?.lat, lng: coords?.lng, duration_hours: 4, items });
      const summary = items.map((i) => i.qty > 1 ? `${tradeTitle(i.type)} ×${i.qty}` : tradeTitle(i.type)).join(' · ') + (loc ? `  ·  ${loc}` : '');
      setSearchReq({ id, summary });
      setItems([]); setLoc(''); setCoords(null); setStep(1);
      setMode('searching');
      load();
    } catch (e) { setMsg('Send failed: ' + friendly(e)); setMode('new'); } finally { setBusy(false); }
  }
  function openReview(reqId) {
    const req = (mine || []).find((r) => r.id === reqId);
    if (req) setReviewReq(req);
  }
  // Approval → Stripe capture now runs through useClientPayFlow (beginApproval), same as Home.
  async function cancel(reqId) {
    setBusy(true); setBusyId(reqId); setMsg('');
    try { await cancelRequest(reqId); await load(); setMsg('Job cancelled — you haven’t been charged, and any card hold has been released.'); }
    catch (e) { setMsg('Cancel failed: ' + friendly(e)); logError('cancel', e, { correlationId: reqId, appContext: 'client' }); } finally { setBusy(false); setBusyId(null); }
  }
  async function repost(reqId) {
    setBusy(true); setBusyId(reqId); setMsg('');
    try { await repostRequest(reqId); await load(); setMsg('✓ Re-posted to the pool — workers notified.'); }
    catch (e) { setMsg('Re-post failed: ' + friendly(e)); } finally { setBusy(false); setBusyId(null); }
  }

  if (mode === 'searching' && searchReq) {
    return (
      <SearchingScreen
        requestId={searchReq.id}
        summary={searchReq.summary}
        onViewJob={() => { setSearchReq(null); setMode('list'); load(); }}
        onClose={() => { setSearchReq(null); setMode('list'); load(); }}
      />
    );
  }

  if (mode === 'new' && picker) {
    return (
      <View style={[S_.fill, { padding: S.xl, paddingTop: 48 }]}>
        <Text style={[T.eyebrow, { marginBottom: 14 }]}>Add an item</Text>
        <TradePicker onPick={addTrade} onCancel={() => setPicker(false)} />
      </View>
    );
  }

  if (mode === 'new') {
    const canSend = items.length > 0 && loc.trim();
    return (
      <KeyboardAvoidingView style={S_.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <TouchableOpacity onPress={() => setMode('list')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={S_.back}>‹ Cancel</Text>
            </TouchableOpacity>
          </View>
          <Text style={[T.dataBig, { fontSize: 26, marginBottom: 2 }]}>What do you need on site?</Text>
          <Text style={[T.small, { color: C.mute, marginBottom: 20 }]}>Add what you need, tell us where. We'll find it.</Text>

          {/* ITEMS — the focus of the screen. Rate lives inline as an editable chip. */}
          {items.map((it) => (
            <View key={it.trade_id} style={S_.composeItem}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <View style={S_.composeIcon}><Icon name={iconForType(it.type, it.kind)} size={20} color={C.indigo} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={T.bodyStrong}>{tradeTitle(it.type)}{it.qty > 1 ? `  ×${it.qty}` : ''}</Text>
                  <Text style={[T.label, { fontSize: 10, marginTop: 1, color: C.mute }]}>{it.kind === 'task' ? 'Community runner' : it.kind === 'crew' ? it.tickets.join(' · ') : 'Wet · with driver'}</Text>
                </View>
                {it.kind !== 'gear' && (
                  <View style={S_.qty}>
                    <TouchableOpacity onPress={() => bump(it.trade_id, -1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={S_.qtyBtn}>−</Text></TouchableOpacity>
                    <Text style={S_.qtyVal}>{it.qty}</Text>
                    <TouchableOpacity onPress={() => bump(it.trade_id, 1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={S_.qtyBtn}>＋</Text></TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity onPress={() => removeItem(it.trade_id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={S_.rm}>✕</Text></TouchableOpacity>
              </View>
              {/* inline rate — pre-filled to the going rate, tweakable, never a gate */}
              <View style={S_.rateInline}>
                <TouchableOpacity onPress={() => setRate(it.trade_id, Math.max(5, (it.rate || 0) - 5))} style={S_.rateStep}><Text style={S_.rateStepT}>−</Text></TouchableOpacity>
                <Text style={S_.rateInlineVal}>${it.rate}{it.priceMode === 'job' ? '/job' : '/hr'}</Text>
                <TouchableOpacity onPress={() => setRate(it.trade_id, (it.rate || 0) + 5)} style={S_.rateStep}><Text style={S_.rateStepT}>＋</Text></TouchableOpacity>
                <Text style={[T.label, { fontSize: 9, color: C.mute, marginLeft: 8 }]}>going rate — tweak if you like</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity style={S_.composeAdd} onPress={() => setPicker(true)} activeOpacity={0.8}>
            <Text style={S_.composeAddT}>＋  Add {items.length ? 'another' : 'what you need'}</Text>
          </TouchableOpacity>

          {/* LOCATION + WHEN — quiet, defaulted, only as loud as they need to be */}
          <View style={{ height: 22 }} />
          <Text style={[T.label, { marginBottom: 8 }]}>Where</Text>
          <AddressField
            value={loc}
            onChangeText={(t) => { setLoc(t); setCoords(null); }}
            onPick={(r) => { setLoc(r.label); setCoords({ lat: r.lat, lng: r.lng }); }}
            picked={!!coords}
            disabled={busy}
          />
          <View style={{ height: 14 }} />
          <Text style={[T.label, { marginBottom: 8 }]}>When</Text>
          <View style={S_.seg}>
            <SegBtn label="Now — urgent" on={when === 'now'} onPress={() => setWhen('now')} />
            <SegBtn label="Book ahead" on={when === 'scheduled'} onPress={() => setWhen('scheduled')} />
          </View>

          {/* live estimate — quiet reassurance, not a decision */}
          {items.length > 0 && (
            <View style={S_.composeEst}>
              <Text style={[T.small, { color: C.mute }]}>Estimated total · 4h</Text>
              <Text style={T.money}>~${estTotal(items).toLocaleString()}</Text>
            </View>
          )}
          {!!msg && <Text style={msg[0] === "✓" ? S_.successText : S_.msg}>{msg}</Text>}
        </ScrollView>

        {/* ONE primary action, pinned in the thumb zone */}
        <View style={S_.composeFooter}>
          <PrimaryBtn
            label={busy ? 'Sending…' : !items.length ? 'Add what you need' : !loc.trim() ? 'Add a location' : 'Send request →'}
            onPress={post} busy={busy} disabled={!canSend}
          />
        </View>
      </KeyboardAvoidingView>
    );
  }

  // LIST mode
  const FILTERS = [['active','Active'],['ready','Ready to pay'],['past','Past']];
  const counts = { active: 0, ready: 0, past: 0 };
  (mine || []).forEach((r) => { counts[reqGroupOf(r)] += 1; });
  const shown = (mine || []).filter((r) => reqGroupOf(r) === filter);

  return (
    <View style={{ flex: 1 }}>
    {/* Virtualized: the Past filter can hold 100+ requests. A FlatList only mounts the rows on screen
        (+ a small buffer), so scrolling stays smooth no matter how long the history grows. */}
    <FlatList
      data={mine === null ? [] : shown}
      keyExtractor={(r) => r.id}
      renderItem={({ item: r }) => (
        <FullReqCard r={r} busy={busyId === r.id} defaultOpen={focusReq === r.id} onApprove={() => openReview(r.id)} onCancel={() => cancel(r.id)} onRepost={() => repost(r.id)} />
      )}
      contentContainerStyle={{ padding: S.xl, paddingBottom: 116, flexGrow: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={C.indigo} colors={[C.indigo]} />}
      keyboardShouldPersistTaps="handled"
      removeClippedSubviews
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      ListHeaderComponent={(
        <>
          <View style={S_.rowBetween}>
            <Text style={T.eyebrow}>My requests</Text>
            <LiveTag />
          </View>
          <TouchableOpacity style={S_.newBtn} onPress={() => setSheetOpen(true)} activeOpacity={0.9}>
            <Text style={S_.newBtnText}>＋ New request</Text>
          </TouchableOpacity>
          {/* filter bar — a plain row (three short chips never need to scroll) */}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, paddingVertical: 4 }}>
            {FILTERS.map(([key, label]) => {
              const n = counts[key] || 0;
              const on = filter === key;
              return (
                <TouchableOpacity key={key} style={[S_.filterChip, on && S_.filterChipOn]} onPress={() => setFilter(key)} activeOpacity={0.8}>
                  <Text style={[S_.filterT, on && S_.filterTOn]}>{label}</Text>
                  <Text style={[S_.filterN, on && S_.filterNOn]}>{n}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {!!msg && (
            <View style={msg.startsWith('✓') ? S_.successBanner : null}>
              <Text style={msg.startsWith('✓') ? S_.successText : S_.msg}>{msg}</Text>
            </View>
          )}
        </>
      )}
      ListEmptyComponent={(
        mine === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 12 }} />
          : (mine || []).length === 0
            ? <EmptyState icon="requests" title="Post your first job"
                sub="Tell us what you need on site and skilled crews nearby get notified — often on site within the hour. You only pay once the work's done."
                cta="＋ New request" onPress={() => setSheetOpen(true)} />
            : <EmptyState icon="requests"
                title={filter === 'active' ? 'Nothing live right now' : filter === 'ready' ? 'Nothing waiting on you' : 'Nothing here yet'}
                sub={filter === 'active' ? 'Post a job and it’ll appear here while crews are matched.' : 'Jobs you’ve finished with will show under Past.'} />
      )}
    />
    <RequestSheet
      visible={sheetOpen}
      onClose={() => setSheetOpen(false)}
      myLoc={null}
      onPosted={async (id, est, label) => { setSheetOpen(false); await load(); setMsg('Job posted — crews nearby are being notified. You pay only once the work is done.'); }}
    />
    {PaySheet}
    <RateJob
      visible={!!ratePrompt}
      assignmentId={ratePrompt?.assignmentId}
      rateeName={ratePrompt?.rateeName}
      onClose={() => setRatePrompt(null)}
    />
    <ReviewApprove
      visible={!!reviewReq}
      request={reviewReq}
      onClose={() => setReviewReq(null)}
      onConfirm={(adj) => { const id = reviewReq.id; setReviewReq(null); beginApproval(id, adj); }}
    />
    </View>
  );
}

/* ============================================================ CLIENT · ACTIVITY */
// Australian financial year (1 Jul – 30 Jun) for the spend summaries.
function auFyStartC(d = new Date()) { const july1 = new Date(d.getFullYear(), 6, 1); return d >= july1 ? july1 : new Date(d.getFullYear() - 1, 6, 1); }
function auFyLabelC(d = new Date()) { const s = auFyStartC(d); return `FY${String(s.getFullYear()).slice(2)}–${String(s.getFullYear() + 1).slice(2)}`; }
// Monday-anchored start of the current week (local midnight), for the "This week" spend window.
function weekStartC(d = new Date()) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }

function ClientActivity({ session }) {
  const [mine, setMine] = useState(() => cacheGet('client-requests'));   // shares Requests' cache → instant
  useEffect(() => { (async () => {
    try { const d = await listMyRequestsFull(); setMine(d); cacheSet('client-requests', d); }
    catch { setMine((p) => (p == null ? [] : p)); }
  })(); }, []);
  const [period, setPeriod] = useState('month');   // week · month · year (plain English, no "FY" jargon)
  const done = (mine || []).filter((r) => r.status === 'complete');
  const spent = done.reduce((n, r) => n + (Number(r.settle_total) || 0), 0);
  const now = new Date();
  const starts = { week: weekStartC(now).getTime(), month: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), year: auFyStartC(now).getTime() };
  const spentWhen = (r) => new Date(r.approved_at || r.created_at || 0).getTime();
  const inPeriod = done.filter((r) => spentWhen(r) >= starts[period]);
  const periodSpent = inPeriod.reduce((n, r) => n + (Number(r.settle_total) || 0), 0);
  const periodCaption = period === 'week' ? 'this week'
    : period === 'month' ? now.toLocaleDateString('en-AU', { month: 'long' })
    : 'financial year so far';
  const PERIODS = [['week', 'This week'], ['month', 'This month'], ['year', 'This year']];
  return (
    // Virtualized: completed-job history can run to dozens/hundreds of receipts.
    <FlatList
      contentContainerStyle={{ padding: S.xl, paddingBottom: 116 }}
      data={mine === null ? [] : done}
      keyExtractor={(r) => r.id}
      renderItem={({ item: r }) => <ActivityCard r={r} />}
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      removeClippedSubviews
      ListHeaderComponent={(
        <>
          <Text style={T.eyebrow}>Activity</Text>
          <View style={[S_.card, { marginTop: 12, alignItems: 'center', paddingVertical: 24 }]}>
            <Text style={T.label}>Total spent · all time</Text>
            <Text style={[T.dataBig, { fontSize: 34, color: C.ink, marginTop: 6 }]}>${spent.toLocaleString()}</Text>
            <Text style={[T.small, { marginTop: 2 }]}>{done.length} job{done.length !== 1 ? 's' : ''} completed</Text>
          </View>
          {/* Period selector — pick a window, the figure below reacts. No accounting jargon on the face. */}
          <View style={[S_.seg, { marginBottom: 12 }]}>
            {PERIODS.map(([key, label]) => {
              const on = period === key;
              return (
                <TouchableOpacity key={key} style={[S_.segBtn, on && S_.segBtnOn]} onPress={() => setPeriod(key)} activeOpacity={0.85}>
                  <Text style={[S_.segT, on && S_.segTOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={[S_.card, { marginTop: 0, alignItems: 'center', paddingVertical: 18 }]}>
            <Text style={[T.heading, { fontSize: 30, color: C.ink }]}>${periodSpent.toLocaleString()}</Text>
            <Text style={[T.small, { marginTop: 3 }]}>{inPeriod.length} job{inPeriod.length !== 1 ? 's' : ''} · {periodCaption}</Text>
            {period === 'year' && <Text style={[T.tiny, { color: C.mute2, marginTop: 4 }]}>Australian financial year · 1 Jul – 30 Jun</Text>}
          </View>
          <Text style={[T.eyebrow, { marginTop: 8 }]}>History</Text>
        </>
      )}
      ListEmptyComponent={(
        mine === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 12 }} />
          : <Text style={[T.small, { marginTop: 8 }]}>No completed jobs yet.</Text>
      )}
    />
  );
}

// Tidy a raw geocoded address for a receipt line: abbreviate the state, drop the country and any
// duplicate/empty segments. "Windsor, New South Wales, 2756, Australia" → "Windsor NSW 2756".
const AU_STATES = { 'new south wales': 'NSW', 'victoria': 'VIC', 'queensland': 'QLD', 'south australia': 'SA', 'western australia': 'WA', 'tasmania': 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT' };
function tidyAddress(addr) {
  if (!addr) return '';
  const parts = String(addr).split(',').map((s) => s.trim()).filter(Boolean)
    .filter((s) => s.toLowerCase() !== 'australia')
    .map((s) => AU_STATES[s.toLowerCase()] || s);
  return parts.join(', ').replace(/,\s*(\d{4})/, ' $1');   // "…, NSW, 2756" → "…, NSW 2756"
}

function ActivityCard({ r }) {
  const [open, setOpen] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [pay, setPay] = useState(null);   // the Stripe payment behind this job (fetched lazily on expand)
  const items = r.request_items || [];
  const total = Number(r.settle_total || 0);
  const fee = Number(r.settle_fee || 0);
  const net = Number(r.settle_net || 0);
  const d = new Date(r.created_at);
  const summary = items.map((it) => it.qty > 1 ? `${tradeTitle(it.type)} ×${it.qty}` : tradeTitle(it.type)).join(' · ');
  // Pull the real payment record the first time the receipt is opened — the reference + paid date
  // turn "Settled" into a receipt the client can trust and keep.
  useEffect(() => { if (open && pay === null) getPaymentForRequest(r.id).then((p) => setPay(p || false)); }, [open]);
  const paidWhen = pay && (pay.updated_at || pay.created_at) ? new Date(pay.updated_at || pay.created_at) : null;
  const ref = pay?.stripe_payment_intent ? String(pay.stripe_payment_intent).slice(-8).toUpperCase() : null;
  return (
    <View style={S_.card}>
      <TouchableOpacity activeOpacity={0.75} onPress={() => setOpen((o) => !o)}>
        <View style={S_.rowBetween}>
          <Text style={[T.heading, { flex: 1 }]} numberOfLines={1}>{suburbOf(r.address_text)}</Text>
          <View style={[S_.pill, { backgroundColor: C.greenSoft }]}><Text style={[S_.pillT, { color: C.green }]}>Settled</Text></View>
        </View>
        <Text style={[T.small, { marginTop: 4, color: C.mute }]} numberOfLines={1}>{summary}</Text>
        <View style={[S_.rowBetween, { marginTop: 10, alignItems: 'flex-end' }]}>
          <Text style={T.money}>${net.toLocaleString()}</Text>
          <Text style={[T.tiny, { color: C.mute2 }]}>{open ? 'Hide detail ▲' : 'View detail ▾'}</Text>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={S_.actDetail}>
          <View style={S_.actRow}><Text style={S_.actLabel}>Job total</Text><Text style={S_.actVal}>${total.toLocaleString()}</Text></View>
          <View style={S_.actRow}><Text style={S_.actLabel}>Platform fee</Text><Text style={[S_.actVal, { color: C.mute }]}>−${fee.toLocaleString()}</Text></View>
          <View style={[S_.actRow, S_.actTotal]}><Text style={[S_.actLabel, { color: C.ink, fontWeight: '700' }]}>Paid to worker</Text><Text style={[S_.actVal, { color: C.green, fontWeight: '800' }]}>${net.toLocaleString()}</Text></View>
          <View style={[S_.actRow, { marginTop: 8 }]}><Text style={S_.actLabel}>Completed</Text><Text style={S_.actVal}>{d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} · {d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</Text></View>
          {r.address_text ? <View style={S_.actRow}><Text style={S_.actLabel}>Site</Text><Text style={[S_.actVal, { flex: 1, textAlign: 'right' }]} numberOfLines={2}>{tidyAddress(r.address_text)}</Text></View> : null}
          {paidWhen ? <View style={S_.actRow}><Text style={S_.actLabel}>Paid</Text><Text style={S_.actVal}>{paidWhen.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</Text></View> : null}
          {ref ? <View style={S_.actRow}><Text style={S_.actLabel}>Receipt no.</Text><Text style={[S_.actVal, { fontVariant: ['tabular-nums'] }]}>SC-{ref}</Text></View> : null}
          {INVOICE_ENABLED && (
            <TouchableOpacity onPress={() => setShowInvoice(true)} activeOpacity={0.85} style={{ marginTop: 14, backgroundColor: C.indigoSoft, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ color: C.indigo, fontWeight: '800', fontSize: 14 }}>View / share invoice</Text>
            </TouchableOpacity>
          )}
          <Text style={[T.tiny, { color: C.mute2, marginTop: 10 }]}>🔒 Paid securely via Stripe. SiteCall never stores your card.</Text>
        </View>
      )}
      {INVOICE_ENABLED && <Invoice visible={showInvoice} request={r} payment={pay || null} onClose={() => setShowInvoice(false)} />}
    </View>
  );
}

/* ============================================================ OPERATOR · HOME */
function statusWords(s) {
  return s === 'en_route' ? 'On the way' : s === 'on_site' ? 'On site'
    : s === 'complete' ? 'Complete' : s === 'approved' ? 'Approved' : 'Committed';
}
function suburbOf(addr) { return (addr || 'No location').split(',')[0].trim(); }
function buildJobInfo({ a, it, r, workerName }) {
  const rows = [];
  const who = workerName || a?.operator?.full_name;
  if (who) rows.push({ label: 'Worker', value: who.split(' ')[0] });
  if (it?.type) rows.push({ label: 'Job', value: tradeTitle(it.type) });
  if (r?.address_text) rows.push({ label: 'Site', value: r.address_text });
  // who to ask for on arrival (falls back to nothing if the client is the unnamed contact)
  if (r?.site_contact_name) {
    const c = r.site_contact_phone ? `${r.site_contact_name} · ${r.site_contact_phone}` : r.site_contact_name;
    rows.push({ label: 'Ask for', value: c });
  }
  const rate = it?.rate_amount ?? it?.rate ?? a?.gross_amount;
  if (rate != null) rows.push({ label: 'Rate', value: `$${rate}${it?.rate_unit ? '/' + it.rate_unit : ''}` });
  if (a?.status) rows.push({ label: 'Status', value: statusWords(a.status) });
  return rows.length ? rows : null;
}

// RateJob — post-completion rating prompt. Stars + optional comment, submitted
// through the validated RPC. Honest: skippable, one rating per side per job.
// C1: review-before-approve. Before money moves, the client sees what they're approving —
// the job, who did it, hours, the amount breakdown, and the worker's VERIFIED tickets.
// Confirm calls the real approve; "Not yet" backs out. Self-contained like RateJob.
