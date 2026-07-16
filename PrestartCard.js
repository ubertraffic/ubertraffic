// PrestartCard.js — the arrival safety prestart (reg-291-style hazard triggers +
// SWMS acknowledgment). Shown right after check-in, before a job is workable, and
// ONLY when the trade requires it (the caller decides that from compliance_ready).
//
// Four plain yes/no hazard questions with a "what's this?" example each. The moment
// any is answered Yes, triggersAreHRCW() flips true and a SWMS acknowledgment step
// appears — high-risk work needs a site-specific SWMS. Submit records everything via
// submitPrestart(); the SERVER enforces the SWMS rule and can raise 'swms_required',
// which we surface as the safety backstop.
//
// Follows the CloseOutCard pattern/feel. Does NOT touch checkout/completion logic —
// it only calls submitPrestart and, on success, hands back to the caller via onDone().

import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C, S, R, T } from './theme';
import { submitPrestart, triggersAreHRCW } from './complianceService';
import { getPosition } from './location';

// The four triggers, in the exact keys the server rule reads. Each carries a
// plain-language example so a worker never has to guess what a question means.
const QUESTIONS = [
  { key: 'road_traffic',  q: 'Working on or next to a road or live traffic?',
    eg: 'e.g. roadworks, a live lane beside you, or a footpath next to moving cars.' },
  { key: 'mobile_plant',  q: 'Around moving powered plant? (excavators, cranes, loaders)',
    eg: 'e.g. an excavator, crane, forklift, loader or bobcat operating near you.' },
  { key: 'fall_over_2m',  q: 'Any risk of falling more than 2 metres?',
    eg: 'e.g. roof work, scaffold, a ladder, an unguarded edge, a void or an elevated platform.' },
  { key: 'asbestos_demo', q: 'Disturbing asbestos, demolition, or structural work?',
    eg: 'e.g. cutting or removing old sheeting, knocking out walls, or changing anything structural.' },
];

// onDone() = proceed (prestart recorded). onCancel() = "Not yet" (gate stays shut).
export default function PrestartCard({ assignmentId, onDone, onCancel }) {
  const [triggers, setTriggers] = useState({ road_traffic: false, mobile_plant: false, fall_over_2m: false, asbestos_demo: false });
  const [swmsAck, setSwmsAck] = useState(false);
  const [openInfo, setOpenInfo] = useState(null);   // which "what's this?" is expanded
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [forceSwms, setForceSwms] = useState(false);   // server raised swms_required (backstop)

  // Live HRCW check — reveals the SWMS step the instant a hazard is flagged.
  const showSwms = triggersAreHRCW(triggers) || forceSwms;
  const set = (key, val) => setTriggers((t) => ({ ...t, [key]: val }));

  async function submit() {
    if (showSwms && !swmsAck) { setErr('Tick the box to confirm you have a site-specific SWMS and have read it.'); return; }
    setBusy(true); setErr('');
    // GPS best-effort, exactly like the photo capture — never block on it.
    let lat = null, lng = null;
    try { const p = await getPosition(); lat = p.lat; lng = p.lng; } catch (_) {}
    try {
      await submitPrestart(assignmentId, triggers, swmsAck, lat, lng);
      onDone && onDone();
    } catch (e) {
      const m = (e && e.message) || '';
      if (/swms_required/i.test(m)) {
        // Safety backstop: server says this is high-risk and needs the SWMS ack.
        setForceSwms(true);
        setErr('This is high-risk work — you must confirm you have a site-specific SWMS before you can start.');
      } else {
        setErr('Couldn’t submit the prestart. Try again.');
      }
      setBusy(false);
    }
  }

  return (
    <View style={cardStyle}>
      <Text style={[T.eyebrow, { marginBottom: 4 }]}>Safety prestart</Text>
      <Text style={[T.small, { color: C.mute, marginBottom: S.lg }]}>
        Before you start, a few quick safety checks for this site.
      </Text>

      {QUESTIONS.map((item) => {
        const yes = !!triggers[item.key];
        const info = openInfo === item.key;
        return (
          <View key={item.key} style={qRow}>
            <Text style={[T.body, { fontWeight: '700', marginBottom: 12 }]}>{item.q}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => set(item.key, true)} activeOpacity={0.9} style={[segBtn, yes && segYes]}>
                <Text style={[segT, yes && segTOn]}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => set(item.key, false)} activeOpacity={0.9} style={[segBtn, !yes && segNo]}>
                <Text style={[segT, !yes && segTOn]}>No</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => setOpenInfo(info ? null : item.key)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{ marginTop: 12 }}
            >
              <Text style={[T.small, { color: C.indigo, textDecorationLine: 'underline' }]}>{info ? 'Hide' : 'What’s this?'}</Text>
            </TouchableOpacity>
            {info ? <Text style={[T.small, { color: C.mute, marginTop: 8 }]}>{item.eg}</Text> : null}
          </View>
        );
      })}

      {showSwms ? (
        <View style={swmsBox}>
          <Text style={[T.body, { color: C.red, fontWeight: '800', marginBottom: 6 }]}>{'⚠'} High-risk work</Text>
          <Text style={[T.small, { color: C.ink, marginBottom: 14 }]}>
            You{'’'}ve flagged high-risk construction work. You must have a site-specific SWMS (Safe Work Method
            Statement) for this job and have read it before you start.
          </Text>
          <TouchableOpacity onPress={() => setSwmsAck((v) => !v)} activeOpacity={0.9} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[checkbox, swmsAck && checkboxOn]}>{swmsAck ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{'✓'}</Text> : null}</View>
            <Text style={[T.body, { flex: 1, fontWeight: '600' }]}>I have a site-specific SWMS and have read it.</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {err ? <Text style={[T.small, { color: C.red, marginTop: S.md }]}>{err}</Text> : null}

      <TouchableOpacity
        onPress={submit}
        disabled={busy || (showSwms && !swmsAck)}
        activeOpacity={0.9}
        style={{
          backgroundColor: (busy || (showSwms && !swmsAck)) ? C.mute : (showSwms ? C.red : C.green),
          borderRadius: R.md, paddingVertical: 16, alignItems: 'center', marginTop: S.lg,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
          {busy ? 'Submitting…' : showSwms ? 'Confirm high-risk & start' : 'Confirm — no hazards'}
        </Text>
      </TouchableOpacity>

      {onCancel ? (
        <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 12, alignItems: 'center' }}>
          <Text style={[T.small, { color: C.mute }]}>Not yet</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const cardStyle = {
  backgroundColor: '#fff',
  borderRadius: R.lg,
  padding: S.lg,
  margin: S.md,
};
// One question per line with room to breathe — a hairline separates each.
const qRow = {
  paddingVertical: S.lg,
  borderTopWidth: 1,
  borderTopColor: C.line,
};
const segBtn = {
  flex: 1,
  paddingVertical: 14,
  borderRadius: R.md,
  borderWidth: 1.5,
  borderColor: C.line,
  alignItems: 'center',
  justifyContent: 'center',
};
const segYes = { backgroundColor: C.amber, borderColor: C.amber };   // Yes = a flagged hazard
const segNo = { backgroundColor: C.ink, borderColor: C.ink };        // No = default / clear
const segT = { color: C.ink, fontWeight: '700', fontSize: 15 };
const segTOn = { color: '#fff' };
const swmsBox = {
  borderWidth: 1.5,
  borderColor: C.red,
  borderRadius: R.md,
  padding: S.md,
  marginTop: S.lg,
};
const checkbox = {
  width: 28, height: 28, borderRadius: 7,
  borderWidth: 2, borderColor: C.mute,
  alignItems: 'center', justifyContent: 'center',
};
const checkboxOn = { backgroundColor: C.green, borderColor: C.green };
