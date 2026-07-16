// CloseOutCard.js — the job close-out (Traffio's "docket", stripped to what matters).
//
// One card at Complete that shows exactly what's still needed, captures each, and only
// lets the worker finish when the server gate (compliance_ready) is satisfied. The card
// IS the gate — there's no separate "Forms" tab to hunt through; what's required appears
// inline, and nothing appears when nothing's required (an errand just needs one photo).
//
// It gates completion WITHOUT editing the existing checkOut path: the caller passes an
// onComplete() that does the real check-out; this card only calls it once cleared.

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { C, S, R, T } from './theme';
import { complianceReady, submitSignoff } from './complianceService';
import { getPosition } from './location';
import ProofPhoto from './ProofPhoto';

// A human label + helper for each missing requirement key the gate can return.
const REQ_LABEL = {
  prestart:        'Safety prestart',
  arrival_photo:   'Arrival photo',
  completion_photo:'Completion photo',
  signoff:         'Sign off the job',
};

// onComplete() = the real check-out the caller already has (mapComplete/complete).
// assignmentId = the assignment being closed out. onCancel() closes the card.
export default function CloseOutCard({ assignmentId, onComplete, onCancel }) {
  const [gate, setGate] = useState(null);     // { ready, missing:[], trade }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [signName, setSignName] = useState('');
  const [signing, setSigning] = useState(false);

  const refreshGate = useCallback(async () => {
    try {
      const g = await complianceReady(assignmentId);
      setGate(g);
      setErr('');
    } catch (e) {
      setErr('Couldn\u2019t check requirements. Try again.');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => { refreshGate(); }, [refreshGate]);

  const missing = (gate && gate.missing) || [];
  const needs = (k) => missing.includes(k);
  const ready = !!(gate && gate.ready);

  // Worker sign-on-glass (typed name for now; signature-draw can layer on later).
  async function doSignoff() {
    if (!signName.trim()) { setErr('Type your name to sign off.'); return; }
    setSigning(true); setErr('');
    let lat = null, lng = null;
    try { const p = await getPosition(); lat = p.lat; lng = p.lng; } catch (_) {}
    try {
      await submitSignoff(assignmentId, 'worker', signName.trim(), lat, lng);
      await refreshGate();
    } catch (e) {
      setErr('Couldn\u2019t record sign-off. Try again.');
    } finally {
      setSigning(false);
    }
  }

  // Finish: only proceeds when the gate is satisfied. Calls the real check-out.
  async function finish() {
    setBusy(true); setErr('');
    try {
      // Re-check server-side right before completing — never trust stale client state.
      const g = await complianceReady(assignmentId);
      if (!g.ready) { setGate(g); setErr('Still a step left below.'); setBusy(false); return; }
      await onComplete();   // the caller's existing checkOut
    } catch (e) {
      setErr((e && e.message) || 'Couldn\u2019t complete the job.');
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={cardStyle}>
        <ActivityIndicator color={C.indigo} />
      </View>
    );
  }

  return (
    <View style={cardStyle}>
      <Text style={[T.eyebrow, { marginBottom: 4 }]}>Close out{gate?.trade ? ` · ${gate.trade}` : ''}</Text>
      <Text style={[T.small, { color: C.mute, marginBottom: S.md }]}>
        {ready ? 'All done — you\u2019re clear to finish.' : 'A couple of quick steps before you finish.'}
      </Text>

      {/* Completion photo — the proof spine. Only shown if the trade needs it. */}
      {needs('completion_photo') && (
        <View style={{ marginBottom: S.md }}>
          <ProofPhoto
            assignmentId={assignmentId}
            kind="completion"
            label="Completion photo"
            onCaptured={() => refreshGate()}
          />
        </View>
      )}

      {/* Arrival photo (rare — only some trades) */}
      {needs('arrival_photo') && (
        <View style={{ marginBottom: S.md }}>
          <ProofPhoto
            assignmentId={assignmentId}
            kind="arrival"
            label="Arrival photo"
            onCaptured={() => refreshGate()}
          />
        </View>
      )}

      {/* Prestart still missing — tells the worker to do it (built in stage 5). */}
      {needs('prestart') && (
        <View style={[rowStyle, { borderColor: C.red }]}>
          <Text style={[T.body, { color: C.red, fontWeight: '700' }]}>{'\u26A0'} Safety prestart not done</Text>
          <Text style={[T.small, { color: C.mute, marginTop: 2 }]}>This job needed a prestart at the start of work.</Text>
        </View>
      )}

      {/* Sign off — worker signs on glass (typed name). */}
      {needs('signoff') && (
        <View style={[rowStyle, { borderColor: C.line }]}>
          <Text style={[T.body, { fontWeight: '700', marginBottom: 6 }]}>Sign off the job</Text>
          <Text style={[T.small, { color: C.mute, marginBottom: 8 }]}>
            Confirm the work is done. This protects you if there's any dispute later.
          </Text>
          <TextInput
            style={{
              borderWidth: 1, borderColor: C.line, borderRadius: R.sm,
              paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink, marginBottom: 8,
            }}
            value={signName}
            onChangeText={setSignName}
            placeholder="Type your full name to sign"
            placeholderTextColor={C.mute2}
            autoCapitalize="words"
          />
          <TouchableOpacity
            onPress={doSignoff}
            disabled={signing}
            activeOpacity={0.9}
            style={{ backgroundColor: signing ? C.mute : C.ink, borderRadius: R.sm, paddingVertical: 11, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{signing ? 'Signing\u2026' : 'Sign'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {err ? <Text style={[T.small, { color: C.red, marginTop: S.sm }]}>{err}</Text> : null}

      {/* The finish button — enabled only when the gate is satisfied. */}
      <TouchableOpacity
        onPress={finish}
        disabled={!ready || busy}
        activeOpacity={0.9}
        style={{
          backgroundColor: (!ready || busy) ? C.mute : C.green,
          borderRadius: R.md, paddingVertical: 15, alignItems: 'center', marginTop: S.md,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>
          {busy ? 'Completing\u2026' : ready ? 'Complete job' : 'Finish the steps above'}
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
const rowStyle = {
  borderWidth: 1,
  borderRadius: R.md,
  padding: S.md,
  marginBottom: S.md,
};
