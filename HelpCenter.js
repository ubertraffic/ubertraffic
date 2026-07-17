// HelpCenter.js — a real "get help" area. Opens as a full-screen sheet from anywhere a
// "Need help?" affordance lives (the live tracker, the Account tab). Honest + practical:
// a short how-it-works for the caller's side, the questions people actually hit, and a real
// way to reach a human. Self-contained. Props: visible, onClose, role ('operator' | 'client').
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native';
import { C, S, R, T, shadowSm } from './theme';

// Change this to your real support inbox. Kept in one place so it's easy to swap.
const SUPPORT_EMAIL = 'support@sitecall.com.au';

const STEPS = {
  operator: [
    ['Go online', 'Flip the toggle on your home screen so nearby jobs reach you.'],
    ['Accept a job', 'Tap a job to see the pay, site and timing, then accept the spot.'],
    ['Head over', 'Tap “On the way” so the client can see you’re coming.'],
    ['Check in on site', 'Tap “Arrive” when you get there — this starts the job.'],
    ['Close out', 'Take the completion photo and sign off when the work’s done.'],
    ['Get paid', 'Once the client approves, your pay is on the way.'],
  ],
  client: [
    ['Post a job', 'Tell us what you need, where and when — the nearest crews are alerted in seconds.'],
    ['Watch it fill', 'See workers accept and head to your site, live on the map.'],
    ['They check in', 'Workers check in on site and get to work.'],
    ['Approve & pay', 'Review what was done and approve — that releases payment.'],
  ],
};

const FAQ = {
  operator: [
    ['A job I accepted disappeared', 'Spots are first-come — if the last spot filled or the client cancelled, the job leaves your list. Nothing was charged to you.'],
    ['It won’t let me check in on site', 'Your phone’s GPS shows you away from the site. If you’re actually there, tap “Yes, I’m on site” to confirm. Otherwise check that location permission is on.'],
    ['I can’t accept jobs', 'Site work needs a verified ticket (e.g. a White Card). Add yours under Account → Tickets & expiry — once it’s verified you’re cleared to accept.'],
    ['My ticket says “In review”', 'We’re checking the photo you uploaded by hand. It unlocks the moment it’s verified — usually quickly.'],
    ['When do I get paid?', 'After the client approves the completed job. If they don’t respond, jobs auto-approve on your logged hours so you’re still paid.'],
  ],
  client: [
    ['No one has accepted yet', 'We alert the nearest verified workers first, then widen the search. Urgent jobs reach more crews faster.'],
    ['A worker accepted but hasn’t moved', 'You can message them from the job, or re-post the spot to notify other workers nearby.'],
    ['How do I pay?', 'You approve the job when the work’s done — that’s what releases payment. You review before anything is charged.'],
    ['Is the worker verified?', 'Verified tickets show a ✓ badge on the worker. We capture and check credentials, but always use your own judgement on site.'],
  ],
};

export default function HelpCenter({ visible, onClose, role = 'operator' }) {
  const [open, setOpen] = useState(null);   // index of the expanded FAQ item
  const steps = STEPS[role] || STEPS.operator;
  const faqs = FAQ[role] || FAQ.operator;

  function contact() {
    const subject = encodeURIComponent('SiteCall help');
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}`).catch(() => {});
  }

  return (
    <Modal visible={!!visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={s.screen}>
        <View style={s.head}>
          <Text style={s.h1}>Help</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.done}>Done</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 48 }}>

          {/* Contact — top, because someone opening Help often wants a human now */}
          <TouchableOpacity style={s.contactCard} onPress={contact} activeOpacity={0.9}>
            <View style={s.contactIcon}><Text style={{ fontSize: 20 }}>💬</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.contactT}>Message support</Text>
              <Text style={s.contactSub}>We’ll get back to you — tap to email us</Text>
            </View>
            <Text style={s.chev}>›</Text>
          </TouchableOpacity>

          {/* How it works */}
          <Text style={s.section}>How it works</Text>
          <View style={s.card}>
            {steps.map(([title, body], i) => (
              <View key={i} style={[s.step, i > 0 && s.stepDiv]}>
                <View style={s.stepNum}><Text style={s.stepNumT}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.stepTitle}>{title}</Text>
                  <Text style={s.stepBody}>{body}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* FAQ — tap to expand */}
          <Text style={s.section}>Common questions</Text>
          <View style={s.card}>
            {faqs.map(([q, a], i) => (
              <View key={i} style={[i > 0 && s.stepDiv]}>
                <TouchableOpacity style={s.qRow} onPress={() => setOpen(open === i ? null : i)} activeOpacity={0.7}>
                  <Text style={s.qT}>{q}</Text>
                  <Text style={s.qChev}>{open === i ? '−' : '+'}</Text>
                </TouchableOpacity>
                {open === i ? <Text style={s.aT}>{a}</Text> : null}
              </View>
            ))}
          </View>

          <Text style={s.foot}>Still stuck? Message support above and we’ll help you out.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.xl, paddingTop: 20, paddingBottom: 12 },
  h1: { fontSize: 26, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  done: { color: C.indigo, fontSize: 16, fontWeight: '700' },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.indigo, borderRadius: R.lg, padding: 16 },
  contactIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  contactT: { color: '#fff', fontSize: 16, fontWeight: '800' },
  contactSub: { color: '#fff', opacity: 0.85, fontSize: 12.5, marginTop: 2, fontWeight: '600' },
  chev: { color: '#fff', fontSize: 24, opacity: 0.7, fontWeight: '300' },
  section: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 26, marginBottom: 10 },
  card: { backgroundColor: C.panel, borderRadius: R.lg, padding: 6, ...shadowSm },
  step: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'flex-start' },
  stepDiv: { borderTopWidth: 1, borderTopColor: C.line },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.indigo + '16', alignItems: 'center', justifyContent: 'center' },
  stepNumT: { color: C.indigo, fontWeight: '800', fontSize: 13 },
  stepTitle: { fontSize: 15, fontWeight: '800', color: C.ink },
  stepBody: { fontSize: 13, color: C.mute, marginTop: 2, lineHeight: 18 },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  qT: { flex: 1, fontSize: 14.5, fontWeight: '700', color: C.ink, paddingRight: 10 },
  qChev: { fontSize: 20, color: C.mute, fontWeight: '400' },
  aT: { fontSize: 13.5, color: C.mute, lineHeight: 19, paddingHorizontal: 14, paddingBottom: 14, marginTop: -2 },
  foot: { fontSize: 12.5, color: C.mute2, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
