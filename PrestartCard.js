// PrestartCard.js — the arrival safety prestart (reg-291-style hazard triggers + SWMS
// acknowledgment). Shown right after check-in, before a job is workable, and ONLY when the
// trade requires it (the caller decides that from compliance_ready).
//
// Four plain yes/no hazard questions, each with a crisp hazard DIAGRAM and a one-line example so a
// worker never has to guess what a question means — no expand/collapse, so the whole check fits on
// one screen without scrolling. The moment any is answered Yes, triggersAreHRCW() flips true and a
// SWMS acknowledgment step appears — high-risk work needs a site-specific SWMS. Submit records
// everything via submitPrestart(); the SERVER enforces the SWMS rule and can raise 'swms_required'.
//
// Does NOT touch checkout/completion logic — it only calls submitPrestart and hands back via onDone().

import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C, S, R, T } from './theme';
import { submitPrestart, triggersAreHRCW } from './complianceService';
import { getPosition } from './location';
import HazardIcon from './HazardIcons';

// The four triggers, in the exact keys the server rule reads. Each carries a hazard colour + a short
// plain-language example, so the row reads instantly: diagram + question + example + Yes/No.
const QUESTIONS = [
  { key: 'road_traffic',  q: 'On or next to live traffic?',        eg: 'Roadworks, live lanes, moving cars',      color: '#B87514' },
  { key: 'mobile_plant',  q: 'Around moving powered plant?',       eg: 'Excavator, crane, forklift, loader',      color: '#2C6E8F' },
  { key: 'fall_over_2m',  q: 'Risk of falling over 2 metres?',     eg: 'Roof, scaffold, ladder, open edge',       color: '#C0492B' },
  { key: 'asbestos_demo', q: 'Asbestos, demolition or structural?', eg: 'Cutting old sheeting, structural work',  color: '#B00020' },
];

// onDone() = proceed (prestart recorded). onCancel() = "Not yet" (gate stays shut).
export default function PrestartCard({ assignmentId, onDone, onCancel }) {
  const [triggers, setTriggers] = useState({ road_traffic: false, mobile_plant: false, fall_over_2m: false, asbestos_demo: false });
  const [swmsAck, setSwmsAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [forceSwms, setForceSwms] = useState(false);   // server raised swms_required (backstop)

  const showSwms = triggersAreHRCW(triggers) || forceSwms;
  const set = (key, val) => setTriggers((t) => ({ ...t, [key]: val }));

  async function submit() {
    if (showSwms && !swmsAck) { setErr('Tick the box to confirm you have a site-specific SWMS and have read it.'); return; }
    setBusy(true); setErr('');
    let lat = null, lng = null;
    try { const p = await getPosition(); lat = p.lat; lng = p.lng; } catch (_) {}
    try {
      await submitPrestart(assignmentId, triggers, swmsAck, lat, lng);
      onDone && onDone();
    } catch (e) {
      const m = (e && e.message) || '';
      if (/swms_required/i.test(m)) {
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
      <Text style={[T.eyebrow, { marginBottom: 2 }]}>Safety prestart</Text>
      <Text style={[T.small, { color: C.mute, marginBottom: 10 }]}>Quick site checks before you start.</Text>

      {QUESTIONS.map((item) => {
        const yes = !!triggers[item.key];
        return (
          <View key={item.key} style={qRow}>
            <View style={[iconWrap, { backgroundColor: item.color + '18' }]}>
              <HazardIcon name={item.key} size={26} color={item.color} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={qText} numberOfLines={2}>{item.q}</Text>
              <Text style={egText} numberOfLines={1}>{item.eg}</Text>
            </View>
            <View style={ynWrap}>
              <TouchableOpacity onPress={() => set(item.key, false)} activeOpacity={0.85} style={[ynBtn, !yes && ynNo]}>
                <Text style={[ynT, !yes && ynTOn]}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => set(item.key, true)} activeOpacity={0.85} style={[ynBtn, yes && ynYes]}>
                <Text style={[ynT, yes && ynTOn]}>Yes</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {showSwms ? (
        <View style={swmsBox}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <HazardIcon name="asbestos_demo" size={20} color={C.red} />
            <Text style={[T.body, { color: C.red, fontWeight: '800' }]}>High-risk work</Text>
          </View>
          <Text style={[T.small, { color: C.ink, marginBottom: 12, lineHeight: 18 }]}>
            You must have a site-specific SWMS (Safe Work Method Statement) for this job and have read it before you start.
          </Text>
          <TouchableOpacity onPress={() => setSwmsAck((v) => !v)} activeOpacity={0.9} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={[checkbox, swmsAck && checkboxOn]}>{swmsAck ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>{'✓'}</Text> : null}</View>
            <Text style={[T.body, { flex: 1, fontWeight: '600' }]}>I have a site-specific SWMS and have read it.</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {err ? <Text style={[T.small, { color: C.red, marginTop: 10 }]}>{err}</Text> : null}

      <TouchableOpacity
        onPress={submit}
        disabled={busy || (showSwms && !swmsAck)}
        activeOpacity={0.9}
        style={{
          backgroundColor: (busy || (showSwms && !swmsAck)) ? C.mute : (showSwms ? C.red : C.green),
          borderRadius: R.md, paddingVertical: 15, alignItems: 'center', marginTop: 14,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
          {busy ? 'Submitting…' : showSwms ? 'Confirm high-risk & start' : 'All clear — start'}
        </Text>
      </TouchableOpacity>

      {onCancel ? (
        <TouchableOpacity onPress={onCancel} style={{ paddingVertical: 10, alignItems: 'center' }}>
          <Text style={[T.small, { color: C.mute }]}>Not yet</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const cardStyle = { backgroundColor: '#fff', borderRadius: R.lg, padding: S.md, margin: S.md };
// Compact one-line-per-hazard row: [diagram] [question + example] [No/Yes]. A hairline separates each.
const qRow = {
  flexDirection: 'row', alignItems: 'center', gap: 12,
  paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.line,
};
const iconWrap = { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' };
const qText = { fontSize: 14.5, fontWeight: '800', color: C.ink, letterSpacing: -0.2 };
const egText = { fontSize: 11.5, color: C.mute, marginTop: 2, fontWeight: '600' };
const ynWrap = { flexDirection: 'row', gap: 6 };
const ynBtn = {
  width: 46, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: C.line,
  alignItems: 'center', justifyContent: 'center',
};
const ynYes = { backgroundColor: C.amber, borderColor: C.amber };   // Yes = a flagged hazard
const ynNo = { backgroundColor: C.ink, borderColor: C.ink };        // No = default / clear
const ynT = { color: C.ink, fontWeight: '800', fontSize: 14 };
const ynTOn = { color: '#fff' };
const swmsBox = { borderWidth: 1.5, borderColor: C.red, borderRadius: R.md, padding: S.md, marginTop: 14 };
const checkbox = { width: 28, height: 28, borderRadius: 7, borderWidth: 2, borderColor: C.mute, alignItems: 'center', justifyContent: 'center' };
const checkboxOn = { backgroundColor: C.green, borderColor: C.green };
