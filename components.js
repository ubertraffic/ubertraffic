// components.js — leaf components + helpers extracted from App.js so App.js fits under the
// mobile paste limit. These are called from App.js, which imports them back.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Animated, Easing, Modal, StyleSheet, Dimensions, KeyboardAvoidingView, Platform } from 'react-native';
import { C, R, S, E, T } from './theme';
import { S_ } from './styles';
import Icon from './Icon';
import { supabase } from './supabaseClient';
import { submitRating, setRatingExtras } from './ratingsService';
import { GOOD_UNIT_TAGS } from './reputation';
import { coworkersOnJob, vouchForPeer } from './communityService';
import SafetyRecordCard from './SafetyRecordCard';
import { logError } from './errorService';
import { listMaterialClaims, resolveMaterialClaim, submitMaterialClaim } from './completionService';
import { verifiedCredentialsFor } from './credentialsService';
import { Entrance, PressableScale, AnimatedBar, useCountUp, CrossFade, useAttentionBump } from './Motion';

const SCREEN_H = Dimensions.get('window').height;

// local copy (App.js keeps its own) — tiny pure helper, safe to duplicate
export function suburbOf(addr) { return (addr || 'No location').split(',')[0].trim(); }

export function ReviewApprove({ visible, request, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [claims, setClaims] = useState(null);      // material claims on this job
  const [err, setErr] = useState('');

  useEffect(() => { if (visible) { setErr(''); } }, [visible, request]);

  // pull the WHOLE crew (every filled spot) + the money preview. Previously this broke on the
  // first worker, so workers 2..N were invisible and the client couldn't see/settle them.
  const info = React.useMemo(() => {
    if (!request) return null;
    const crew = [];
    let base = 0, labourBase = 0;   // labourBase = hourly work only; the 10% fee applies to it, not tasks
    const hours = request.duration_hours || 4;
    let anyIncomplete = false;
    for (const it of (request.request_items || [])) {
      const rate = it.rate != null ? it.rate : (it.rate_offered != null ? it.rate_offered : 0);
      const perItem = it.price_mode === 'job' ? Number(rate) : Number(rate) * hours;
      for (const a of (it.assignments || [])) {
        if (a.status === 'cancelled' || !a.operator_id) continue;
        const done = ['complete', 'approved'].includes(a.status);
        if (!done) anyIncomplete = true;
        crew.push({
          assignment_id: a.id,
          operator_id: a.operator_id,
          name: a.operator?.full_name || 'Worker',
          trade: it.type,
          status: a.status,
          done,
          pay: done ? perItem : 0,
          events: a.job_events || [],   // embedded from listMyRequestsFull — feeds the safety record
        });
        if (done) { base += perItem; if (it.price_mode !== 'job') labourBase += perItem; }
      }
    }
    // primary (for single-worker back-compat display fields)
    const first = crew.find((m) => m.done) || crew[0] || null;
    // Fee model: 10% of labour only. Tasks are 100% to the worker (client pays a flat booking fee
    // on top, handled at checkout). Tips + travel are always 100% to the worker.
    const fee = Math.round(labourBase * 0.10 * 100) / 100;
    // if already settled, use the real settled figures
    let total, feeF, net;
    if (request.settle_total != null) {
      total = request.settle_total; feeF = request.settle_fee; net = request.settle_net;
    } else {
      total = base; feeF = fee; net = base - fee;
    }
    return { crew, primary: first, total, fee: feeF, net, hours, anyIncomplete, doneCount: crew.filter((m) => m.done).length };
  }, [request]);

  useEffect(() => {
    if (!visible || !request) { setClaims(null); return; }
    listMaterialClaims(request.id).then(setClaims).catch(() => setClaims([]));
  }, [visible, request]);

  async function approveClaim(claimId, ok) {
    try {
      await resolveMaterialClaim(claimId, ok);
      const updated = await listMaterialClaims(request.id);
      setClaims(updated);
    } catch (e) { setErr((e && e.message) || 'Could not update the materials claim — try again.'); logError('materials_resolve', e, { correlationId: claimId, appContext: 'client' }); }
  }

  if (!visible || !request) return null;
  const money = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
  const opName = info?.primary?.name || 'the worker';
  const isCrewJob = (info?.crew?.length || 0) > 1;
  const adjTotal = 0;   // tips + travel now live in the pay sheet, not on this review screen
  const matApproved = (claims || []).filter((c) => c.status === 'approved').reduce((s, c) => s + Number(c.amount), 0);
  const matPending = (claims || []).filter((c) => c.needs_approval && c.status === 'pending');
  const shownTotal = (info?.total || 0) + adjTotal + matApproved;
  const shownNet = (info?.net || 0) + adjTotal + matApproved;

  async function confirm() {
    setBusy(true); setErr('');
    try { await onConfirm({ tip: 0, travel: 0 }); }
    catch (e) { setErr((e && e.message) || 'Approve failed.'); setBusy(false); }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={S_.revScrim}>
        <TouchableOpacity style={S_.revBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={S_.revSheet}>
          <View style={S_.revHandle} />
          <Text style={S_.revTitle}>Review before you pay</Text>
          <Text style={S_.revSub}>Check the work before releasing payment.</Text>

          {/* Body scrolls inside a capped region so the sheet stays ~half-screen and the
              Approve/Not-yet buttons are always visible (pinned below), no matter how much
              crew/safety detail there is. */}
          <ScrollView style={{ maxHeight: SCREEN_H * 0.42 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 2 }}>
          <View style={S_.revCard}>
            <ReviewRow k="Job" v={`${info?.primary?.trade || 'Job'}${isCrewJob ? ` · crew of ${info.crew.length}` : ''}`} />
            {isCrewJob ? (
              <ReviewRow k="Crew" v={`${info.doneCount} of ${info.crew.length} finished`} />
            ) : (
              <ReviewRow k="Worker" v={opName} />
            )}
            <ReviewRow k="Booked hours" v={info?.hours ? `${info.hours} hr` : '—'} />
            <ReviewRow k="Where" v={suburbOf(request.address_text)} />
          </View>

          {/* crew roster — every worker, their status + pay (so nobody is invisible) */}
          {isCrewJob && (
            <View style={S_.revTickets}>
              <Text style={S_.revTicketsLabel}>Crew</Text>
              {info.crew.map((m) => (
                <View key={m.assignment_id} style={S_.revCrewRow}>
                  <View style={[S_.revCrewDot, { backgroundColor: m.done ? C.green : C.amber }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={S_.revCrewName}>{m.name}<Text style={S_.revCrewTrade}>  ·  {m.trade}</Text></Text>
                    <Text style={S_.revCrewStatus}>{m.done ? 'Finished' : m.status === 'on_site' ? 'On site — still working' : m.status === 'en_route' ? 'On the way' : 'Booked'}</Text>
                  </View>
                  <Text style={S_.revCrewPay}>{m.done ? money(m.pay) : '—'}</Text>
                </View>
              ))}
              {info.anyIncomplete && <Text style={[T.small, { color: C.amber, marginTop: 6 }]}>Waiting on {info.crew.length - info.doneCount} of {info.crew.length} to finish before you can approve.</Text>}
            </View>
          )}

          {/* materials claims — reimbursement, separate from labour */}
          {claims && claims.length > 0 && (
            <View style={S_.revTickets}>
              <Text style={S_.revTicketsLabel}>Materials</Text>
              {claims.map((c) => (
                <View key={c.id} style={S_.revMatRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S_.revMatAmt}>${Number(c.amount).toFixed(2)}{c.note ? <Text style={S_.revMatNote}> · {c.note}</Text> : null}</Text>
                    <Text style={S_.revMatMeta}>{c.receipt_url ? 'Receipt attached' : 'No receipt'}{c.status === 'approved' ? ' · approved' : c.status === 'rejected' ? ' · rejected' : ''}</Text>
                  </View>
                  {c.needs_approval && c.status === 'pending' ? (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <TouchableOpacity style={S_.revMatNo} onPress={() => approveClaim(c.id, false)}><Text style={S_.revMatNoT}>Deny</Text></TouchableOpacity>
                      <TouchableOpacity style={S_.revMatOk} onPress={() => approveClaim(c.id, true)}><Text style={S_.revMatOkT}>Approve</Text></TouchableOpacity>
                    </View>
                  ) : c.status === 'approved' ? <Text style={S_.revMatTick}>✓</Text> : null}
                </View>
              ))}
              {matPending.length > 0 && <Text style={[T.small, { color: C.amber, marginTop: 6 }]}>Approve or deny flagged materials before paying.</Text>}
            </View>
          )}

          {/* SAFETY RECORD — what was captured on site + the client's own sign-off. A shared
              record and an acknowledgement, not a safety guarantee (honest-language rule). */}
          {info?.crew?.some((m) => m.done) && (
            <View style={S_.revTickets}>
              <Text style={S_.revTicketsLabel}>Safety record</Text>
              {info.crew.filter((m) => m.done).map((m) => (
                <SafetyRecordCard key={m.assignment_id} member={m} />
              ))}
            </View>
          )}

          {/* amount breakdown — reflects adjustments live */}
          <View style={S_.revMoney}>
            <View style={S_.revMoneyRow}><Text style={S_.revMoneyKmute}>Labour</Text><Text style={S_.revMoneyVmute}>{money(info?.total)}</Text></View>
            {adjTotal > 0 && <View style={S_.revMoneyRow}><Text style={S_.revMoneyKmute}>Tip + travel</Text><Text style={S_.revMoneyVmute}>+{money(adjTotal)}</Text></View>}
            {matApproved > 0 && <View style={S_.revMoneyRow}><Text style={S_.revMoneyKmute}>Materials</Text><Text style={S_.revMoneyVmute}>+{money(matApproved)}</Text></View>}
            <View style={S_.revMoneyRow}><Text style={S_.revMoneyK}>Total</Text><Text style={S_.revMoneyV}>{money(shownTotal)}</Text></View>
            {info?.fee != null && <View style={S_.revMoneyRow}><Text style={S_.revMoneyKmute}>Platform fee (10% of labour)</Text><Text style={S_.revMoneyVmute}>{money(info.fee)}</Text></View>}
            <View style={S_.revMoneyRow}><Text style={S_.revMoneyK}>To worker</Text><Text style={S_.revMoneyVnet}>{money(shownNet)}</Text></View>
          </View>
          <Text style={[T.small, { color: C.mute2, marginTop: 8, lineHeight: 17 }]}>SiteCall keeps 10% of labour + $3 per task. Tips & travel go 100% to the worker.</Text>
          </ScrollView>

          {!!err && <Text style={S_.revErr}>{err}</Text>}

          <TouchableOpacity style={[S_.revConfirm, (busy || matPending.length > 0 || info?.anyIncomplete) && { opacity: 0.6 }]} onPress={confirm} disabled={busy || matPending.length > 0 || info?.anyIncomplete}>
            <Text style={S_.revConfirmT}>{busy ? 'Approving…' : matPending.length > 0 ? 'Resolve materials first' : info?.anyIncomplete ? 'Waiting on the crew to finish' : `Approve & pay ${money(shownTotal)}`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10 }} disabled={busy}>
            <Text style={S_.revCancel}>Not yet</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
export function ReviewRow({ k, v }) {
  return <View style={S_.revInfoRow}><Text style={S_.revInfoK}>{k}</Text><Text style={S_.revInfoV} numberOfLines={1}>{v}</Text></View>;
}

// C4: worker submits a materials reimbursement claim. Receipt needed over $30 (else it
// routes to client approval); over the job's cap also needs approval. Self-contained modal.
export function MaterialsClaim({ visible, assignment, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState('');   // receipt reference/url (photo upload needs bucket)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (visible) { setAmount(''); setNote(''); setReceipt(''); setErr(''); } }, [visible, assignment]);
  if (!visible || !assignment) return null;

  const amt = parseFloat(amount) || 0;
  const cap = assignment.request_item?.request?.materials_cap || 0;
  const overThreshold = amt > 30;
  const needsReceipt = overThreshold && !receipt.trim();

  async function submit() {
    if (amt <= 0) { setErr('Enter an amount.'); return; }
    setBusy(true); setErr('');
    try {
      await submitMaterialClaim(assignment.id, amt, receipt.trim() || null, note.trim() || null);
      onDone && onDone();
      onClose && onClose();
    } catch (e) { setErr((e && e.message) || 'Could not submit.'); setBusy(false); logError('materials_submit', e, { correlationId: assignment.id, appContext: 'operator' }); }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={S_.revScrim}>
        <TouchableOpacity style={S_.revBackdrop} activeOpacity={1} onPress={onClose} />
        <View style={S_.revSheet}>
          <View style={S_.revHandle} />
          <Text style={S_.revTitle}>Add materials</Text>
          <Text style={S_.revSub}>{cap > 0 ? `Budget for this job: up to $${cap}.` : 'No materials budget set — this will need client approval.'}</Text>
          <Text style={S_.revAdjLabel}>Amount spent</Text>
          <TextInput style={S_.revTravelInput} value={amount} onChangeText={setAmount} placeholder="$0" placeholderTextColor={C.mute2} keyboardType="decimal-pad" />
          <Text style={S_.revAdjLabel}>What did you buy?</Text>
          <TextInput style={S_.revTravelInput} value={note} onChangeText={setNote} placeholder="e.g. 2× cement bags, screws" placeholderTextColor={C.mute2} />
          <Text style={S_.revAdjLabel}>Receipt reference {overThreshold ? '(required over $30)' : '(optional)'}</Text>
          <TextInput style={S_.revTravelInput} value={receipt} onChangeText={setReceipt} placeholder="Receipt number / photo ref" placeholderTextColor={C.mute2} />
          {needsReceipt && <Text style={[T.small, { color: C.amber, marginTop: 8 }]}>Over $30 without a receipt — the client will need to approve this.</Text>}
          {amt > cap && cap > 0 && <Text style={[T.small, { color: C.amber, marginTop: 8 }]}>Over the ${cap} budget — the client will need to approve the extra.</Text>}
          {!!err && <Text style={S_.revErr}>{err}</Text>}
          <TouchableOpacity style={[S_.revConfirm, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
            <Text style={S_.revConfirmT}>{busy ? 'Submitting…' : 'Submit claim'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 10 }} disabled={busy}>
            <Text style={S_.revCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function RateJob({ visible, assignmentId, rateeName, onClose, rateeIsWorker = true }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState([]);          // tapped "good unit" tags
  const [rehire, setRehire] = useState(false);   // "I'd have them back"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { if (visible) { setScore(0); setComment(''); setTags([]); setRehire(false); setErr(''); setDone(false); } }, [visible, assignmentId]);
  function toggleTag(t) { setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); }
  async function submit() {
    if (score < 1) { setErr('Tap a star to rate.'); return; }
    setBusy(true); setErr('');
    try {
      await submitRating(assignmentId, score, comment.trim() || null);
      // Extras ride ON TOP of the rating. If they fail, the star rating already saved —
      // don't surface an error or lose the moment; just proceed.
      if (rateeIsWorker && (tags.length || rehire)) {
        try { await setRatingExtras(assignmentId, tags, rehire); } catch (_) {}
      }
      setDone(true); setTimeout(() => onClose && onClose(true), 900);
    }
    catch (e) { setErr(friendly(e)); } finally { setBusy(false); }
  }
  // A real name → first name ("John Smith" → "John"). A generic phrase ("the client", "the operator")
  // must stay whole — splitting on the space rendered "How was working with the?" (the phantom-name bug).
  const who = !rateeName ? 'them' : /^the\b/i.test(rateeName.trim()) ? rateeName.trim() : rateeName.split(' ')[0];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onClose && onClose(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={S_.rateScrim}>
        <View style={S_.rateCard}>
          {done ? (
            <View style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Text style={S_.rateThanks}>✓ Thanks for the feedback</Text>
            </View>
          ) : (
            <>
              <Text style={S_.rateTitle}>How was working with {who}?</Text>
              <Text style={S_.rateSub}>Your honest rating helps keep the network trustworthy.</Text>
              <View style={S_.rateStars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <TouchableOpacity key={n} onPress={() => setScore(n)} activeOpacity={0.7} style={S_.rateStarBtn}>
                    <Text style={[S_.rateStar, n <= score && S_.rateStarOn]}>★</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {rateeIsWorker && (
                <>
                  <View style={S_.rateTagWrap}>
                    {GOOD_UNIT_TAGS.map((t) => {
                      const on = tags.includes(t);
                      return (
                        <TouchableOpacity key={t} onPress={() => toggleTag(t)} activeOpacity={0.8}
                          style={[S_.rateTag, on && S_.rateTagOn]}>
                          <Text style={[S_.rateTagT, on && S_.rateTagTOn]}>{t}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TouchableOpacity style={S_.rehireRow} onPress={() => setRehire((v) => !v)} activeOpacity={0.8}>
                    <View style={[S_.rehireBox, rehire && S_.rehireBoxOn]}>
                      {rehire && <Text style={S_.rehireTick}>✓</Text>}
                    </View>
                    <Text style={S_.rehireT}>I'd have {who} back</Text>
                  </TouchableOpacity>
                </>
              )}
              <TextInput
                style={S_.rateInput}
                placeholder="Add a comment (optional)"
                placeholderTextColor={C.mute}
                value={comment}
                onChangeText={setComment}
                multiline
              />
              {!!err && <Text style={S_.rateErr}>{err}</Text>}
              <TouchableOpacity style={[S_.rateSubmit, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} activeOpacity={0.9}>
                <Text style={S_.rateSubmitT}>{busy ? 'Submitting…' : 'Submit rating'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onClose && onClose(false)} style={{ paddingVertical: 10 }} activeOpacity={0.7}>
                <Text style={S_.rateSkip}>Skip for now</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// VouchCrewCard — the peer side of reputation. After a shared job, a worker can vouch for
// the workmates they were on site with. Only renders when the server confirms there WERE
// co-workers on this job (and that I was one of them) — so solo jobs show nothing. A vouch
// is un-gameable: vouch_for_peer re-checks both of us worked the job before recording it.
export function VouchCrewCard({ requestId }) {
  const [mates, setMates] = useState(null);    // null = loading, [] = none
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(null);        // the mate currently being vouched
  const [tags, setTags] = useState([]);
  const [busy, setBusy] = useState(false);
  const [vouched, setVouched] = useState({});  // user_id -> true once sent
  useEffect(() => {
    let alive = true;
    coworkersOnJob(requestId).then((r) => { if (alive) setMates(r); }).catch(() => { if (alive) setMates([]); });
    return () => { alive = false; };
  }, [requestId]);
  if (!mates || mates.length === 0) return null;
  function pick(m) { setSel(m); setTags([]); }
  function toggleTag(t) { setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); }
  async function send() {
    if (!sel) return;
    setBusy(true);
    try { await vouchForPeer(requestId, sel.user_id, tags); setVouched((v) => ({ ...v, [sel.user_id]: true })); setSel(null); setTags([]); }
    catch (_) {} finally { setBusy(false); }
  }
  return (
    <>
      <TouchableOpacity style={S_.vouchCard} onPress={() => setOpen(true)} activeOpacity={0.9}>
        <Icon name="crew" size={18} color={C.indigo} strokeWidth={1.9} />
        <View style={{ flex: 1 }}>
          <Text style={S_.vouchCardT}>Vouch for who you worked with</Text>
          <Text style={S_.vouchCardSub}>{mates.length} workmate{mates.length === 1 ? '' : 's'} on this job · builds their reputation</Text>
        </View>
        <Text style={S_.vouchChevron}>›</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={S_.rateScrim}>
          <View style={S_.rateCard}>
            {sel ? (
              <>
                <Text style={S_.rateTitle}>Vouch for {(sel.name || 'them').split(' ')[0]}</Text>
                <Text style={S_.rateSub}>What were they like on site? (optional)</Text>
                <View style={S_.rateTagWrap}>
                  {GOOD_UNIT_TAGS.map((t) => {
                    const on = tags.includes(t);
                    return (
                      <TouchableOpacity key={t} onPress={() => toggleTag(t)} activeOpacity={0.8} style={[S_.rateTag, on && S_.rateTagOn]}>
                        <Text style={[S_.rateTagT, on && S_.rateTagTOn]}>{t}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity style={[S_.rateSubmit, busy && { opacity: 0.6 }]} onPress={send} disabled={busy} activeOpacity={0.9}>
                  <Text style={S_.rateSubmitT}>{busy ? 'Sending…' : 'Send vouch'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSel(null)} style={{ paddingVertical: 10 }} activeOpacity={0.7}>
                  <Text style={S_.rateSkip}>Back</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={S_.rateTitle}>Your crew on this job</Text>
                <Text style={S_.rateSub}>Vouch for the mates you worked with — it builds their reputation.</Text>
                <View style={{ marginTop: 14 }}>
                  {mates.map((m) => (
                    <TouchableOpacity key={m.user_id} disabled={!!vouched[m.user_id]} onPress={() => pick(m)} activeOpacity={0.85} style={S_.vouchRow}>
                      <View style={S_.vouchAv}><Text style={S_.vouchAvT}>{(m.name || '?').charAt(0).toUpperCase()}</Text></View>
                      <Text style={S_.vouchName}>{m.name || 'Workmate'}</Text>
                      {vouched[m.user_id]
                        ? <Text style={S_.vouchDone}>Vouched ✓</Text>
                        : <Text style={S_.vouchGo}>Vouch ›</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity onPress={() => setOpen(false)} style={{ paddingVertical: 12 }} activeOpacity={0.7}>
                  <Text style={S_.rateSkip}>Done</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// SlidingText — a restrained marquee. If the text overflows its container, it
// gently slides to reveal the rest, pauses, and eases back. Static if it fits.
export function SlidingText({ text, style }) {
  const [boxW, setBoxW] = useState(0);
  const [textW, setTextW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const overflow = textW > boxW && boxW > 0;

  useEffect(() => {
    x.stopAnimation();
    x.setValue(0);
    if (!overflow) return;
    const dist = textW - boxW + 6;
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(1400),
      Animated.timing(x, { toValue: -dist, duration: Math.max(1600, dist * 22), useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(x, { toValue: 0, duration: Math.max(1200, dist * 16), useNativeDriver: true }),
    ]));
    loop.start();
    return () => x.stopAnimation();
  }, [overflow, textW, boxW, x]);

  return (
    <View style={{ overflow: 'hidden', alignSelf: 'stretch' }} onLayout={(e) => setBoxW(e.nativeEvent.layout.width)}>
      {/* hidden measurer: renders at natural width so we learn the true text width */}
      <Text
        style={[style, { position: 'absolute', opacity: 0 }]}
        onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
      >{text}</Text>
      <Animated.Text
        style={[style, { transform: [{ translateX: x }] }]}
      >{text}</Animated.Text>
    </View>
  );
}

// MATCH CARD — the Uber moment, at the JOB level. A single-spot job shows one
// worker with a big Message button. A multi-spot job shows "N of M filled" with
// a fill bar and a crew roster — one coherent card, not a pile of per-worker cards.
export function workerLine(a) {
  const liveM = a.live_dist_m != null ? Number(a.live_dist_m) : (a.start_dist_m != null ? Number(a.start_dist_m) : null);
  const distKm = liveM != null ? liveM / 1000 : null;
  const dist = distKm != null ? (distKm < 1 ? 'less than 1 km' : `${distKm.toFixed(distKm < 10 ? 1 : 0)} km`) : null;
  const committed = a.status === 'committed' || a.status === 'accepted';
  if (committed) return 'getting ready';
  if (a.status === 'en_route') return dist ? `on the way · ${dist}` : 'on the way';
  if (a.status === 'on_site') return 'on site';
  if (a.status === 'complete') return 'finished ✓';
  if (a.status === 'approved') return 'paid ✓';
  return a.status.replace('_', ' ');
}

export function MatchCard({ r, crew, needed, unread, onMessageWorker, onOpen, showMessage = true, onOpenProfile }) {
  const suburb = suburbOf(r.address_text);
  const filled = crew.length;
  const multi = needed > 1;
  const anyOnSite = crew.some((c) => c.a.status === 'on_site');
  const accent = anyOnSite ? C.green : C.indigo;

  // SINGLE-SPOT — the clean, familiar one-worker card
  if (!multi) {
    const { a, it } = crew[0];
    const op = a.operator || {};
    const first = (op.full_name || 'Your worker').split(' ')[0];
    const rating = op.rating != null ? Number(op.rating).toFixed(1) : null;
    const jobsDone = op.jobs_done;
    const vehicle = op.vehicle_type;
    const head = (a.status === 'committed' || a.status === 'accepted') ? `${first} has committed to your job`
      : a.status === 'en_route' ? `${first} is on the way`
      : a.status === 'on_site' ? `${first} is on site`
      : `${first} · ${a.status.replace('_', ' ')}`;
    const sub = `${it.type} · ${suburb} · ${workerLine(a)}`;
    return (
      <TouchableOpacity style={S_.matchCard} onPress={onOpen} activeOpacity={0.9}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <TouchableOpacity
            onPress={() => { if (onOpenProfile && a.operator_id) onOpenProfile(a.operator_id); }}
            disabled={!onOpenProfile || !a.operator_id}
            activeOpacity={0.7}
          >
            <View style={[S_.matchAvatar, { backgroundColor: accent }]}><Text style={S_.matchAvatarT}>{first.charAt(0).toUpperCase()}</Text></View>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <CrossFade keyId={a.status}><Text style={S_.matchHead} numberOfLines={1}>{head}</Text></CrossFade>
            <SlidingText text={sub} style={S_.matchSub} />
            <Text style={S_.matchMeta} numberOfLines={1}>
              {repLine(op)}{vehicle ? `  ·  ${vehicle}` : ''}
            </Text>
          </View>
        </View>
        {showMessage ? (
        <PressableScale style={[S_.matchMsgBtn, { backgroundColor: accent }]} onPress={() => onMessageWorker(a, it)}>
          <Text style={S_.matchMsgT}>Message {first}</Text>
          {(unread[a.id] || 0) > 0 && <View style={S_.matchBadge}><Text style={S_.matchBadgeT}>{unread[a.id]}</Text></View>}
        </PressableScale>
        ) : (
          <View style={S_.matchDetailRow}>
            <Text style={S_.matchDetailT} numberOfLines={1}>{it.type} · {suburb} · {workerLine(a)}</Text>
            <Text style={S_.matchDetailChevron}>Details ›</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  // MULTI-SPOT — one job, filling up, with a crew roster
  const type = crew[0]?.it?.type || 'Crew';
  const pct = Math.round((filled / needed) * 100);
  const filledCount = useCountUp(filled);
  const bump = useAttentionBump(filled);   // gentle nudge when a new spot fills
  return (
    <Animated.View style={[S_.matchCard, { transform: [{ scale: bump }] }]}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
        <View style={S_.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={S_.matchHead} numberOfLines={1}>{filledCount} of {needed} spots filled</Text>
            <Text style={S_.matchSub} numberOfLines={1}>{type} · {suburb}</Text>
          </View>
          <CrossFade keyId={filled >= needed ? 'crewed' : 'filling'}>
            <View style={[S_.pill, { backgroundColor: anyOnSite ? C.greenSoft : C.indigoSoft }]}>
              <Text style={[S_.pillT, { color: accent }]}>{filled >= needed ? 'Fully crewed' : 'Filling'}</Text>
            </View>
          </CrossFade>
        </View>
        {/* animated fill bar — grows as spots fill */}
        <AnimatedBar pct={pct} color={accent} height={6}
          trackStyle={{ backgroundColor: C.panel2, marginTop: 12 }} />
      </TouchableOpacity>

      {/* crew roster — each committed worker springs in as they arrive */}
      <View style={{ marginTop: 14, gap: 8 }}>
        {crew.map(({ a, it }, i) => {
          const op = a.operator || {};
          const first = (op.full_name || 'Worker').split(' ')[0];
          const u = unread[a.id] || 0;
          return (
            <Entrance key={a.id} delay={i * 45}>
              <View style={S_.crewRow}>
                <View style={[S_.crewDot, { backgroundColor: (a.status === 'on_site' || a.status === 'complete' || a.status === 'approved') ? C.green : a.status === 'en_route' ? C.indigo : C.mute2 }]} />
                <View style={{ flex: 1 }}>
                  <Text style={S_.crewName} numberOfLines={1}>{first}</Text>
                  <CrossFade keyId={a.status}><Text style={S_.crewStatus} numberOfLines={1}>{workerLine(a)}</Text></CrossFade>
                </View>
                <PressableScale style={S_.crewMsg} onPress={() => onMessageWorker(a, it)}>
                  <Text style={S_.crewMsgT}>Message</Text>
                  {u > 0 && <View style={S_.crewBadge}><Text style={S_.crewBadgeT}>{u}</Text></View>}
                </PressableScale>
              </View>
            </Entrance>
          );
        })}
        {filled < needed && (
          <Text style={S_.crewWaiting}>Waiting on {needed - filled} more…</Text>
        )}
      </View>
    </Animated.View>
  );
}

// A calm, guiding empty state — turns a void into an invitation. Premium apps
// never leave a bare "Nothing here"; they reassure and point the way.
export function EmptyState({ icon, title, sub, cta, onPress }) {
  return (
    <View style={S_.emptyWrap}>
      <View style={S_.emptyIcon}><Icon name={icon || 'requests'} size={26} color={C.mute2} strokeWidth={1.7} /></View>
      <Text style={S_.emptyTitle}>{title}</Text>
      {!!sub && <Text style={S_.emptySub}>{sub}</Text>}
      {cta && onPress && (
        <TouchableOpacity style={S_.emptyCta} onPress={onPress} activeOpacity={0.85}>
          <Text style={S_.emptyCtaT}>{cta}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// A committed spot the operator never started — "stalled". CLAUDE.md §5 unhappy path.
const STALL_MIN = 15;   // minutes after commit with no journey started = stalled
export function isStalledAssignment(a) {
  if (!a || a.status !== 'committed' || a.journey_started_at) return false;
  if (!a.accepted_at) return false;
  return (Date.now() - new Date(a.accepted_at).getTime()) > STALL_MIN * 60 * 1000;
}
// does a request have any stalled spot?
export function requestHasStall(r) {
  return (r.request_items || []).some((it) => (it.assignments || []).some(isStalledAssignment));
}

// Honest reputation line: "New" when unrated, real average + count otherwise.
// Keys off rating_count (a real number) — never shows a fabricated score.
export function repLine(op) {
  if (!op) return 'New';
  const count = op.rating_count || 0;
  if (count === 0 || op.rating == null) return 'New';
  return `★ ${Number(op.rating).toFixed(1)} · ${count} rating${count === 1 ? '' : 's'}`;
}

// Human-readable countdown to the 48h auto-release deadline (C2 worker protection).
// Returns { text, passed } or null. Keeps the worker informed that payment is guaranteed.
export function autoReleaseIn(deadlineIso) {
  if (!deadlineIso) return null;
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (isNaN(ms)) return null;
  if (ms <= 0) return { text: 'now', passed: true };
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hrs >= 1) return { text: `${hrs} hr${hrs > 1 ? 's' : ''}`, passed: false };
  return { text: `${mins} min`, passed: false };
}

export function friendly(e) {
  const m = (e && e.message) || String(e);
  if (/missing_credentials:\s*(.+)/i.test(m)) {
    const need = m.match(/missing_credentials:\s*(.+)/i)[1].trim();
    return `You need ${need} (verified) to accept this job. Add it under Tickets & expiry.`;
  }
  if (/no_spots_left/i.test(m)) return 'That spot was just taken.';
  if (/not_dispatched/i.test(m)) return 'You were not dispatched to this job.';
  if (/not_qualified_task/i.test(m)) return 'You need a verified driver licence and a vehicle on file to take driving tasks.';
  if (/not_qualified_work/i.test(m)) return 'You need a verified White Card to accept site work. Add it under Tickets & expiry.';
  if (/missing_credential/i.test(m)) return 'You\'re missing a required, verified ticket for this job. Check Tickets & expiry.';
  if (/not_your_request/i.test(m)) return "This isn't your request to approve.";
  if (/not_all_complete/i.test(m)) return 'All spots must be complete first.';
  if (/network|fetch/i.test(m)) return 'Network problem — check your connection.';
  if (/permission denied/i.test(m)) return 'Permission error — database grants may be missing.';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  return m;
}

/* ============================================================ STYLES */
