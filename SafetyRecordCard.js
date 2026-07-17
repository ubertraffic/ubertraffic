// SafetyRecordCard.js — the client's view of ONE worker's on-site safety record, plus the
// client's own sign-off. Reads the job_events already embedded on the assignment (no new
// fetch), resolves proof photos to signed URLs, and records a client signature via the
// existing submit_signoff (signer='client'). Additive: never touches the worker flow or money.
//
// HONEST LANGUAGE (owner rule): this is a shared RECORD of what was captured and an
// acknowledgement — never a claim that the site is "safe" or that we are "compliant".
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image, ActivityIndicator } from 'react-native';
import { C, R, T } from './theme';
import { safetyRecordFromEvents, proofPhotoUrl, submitSignoff } from './complianceService';

const TRIGGER_LABEL = {
  road_traffic: 'Road / traffic',
  mobile_plant: 'Mobile plant',
  fall_over_2m: 'Fall over 2m',
  asbestos_demo: 'Asbestos / demolition',
};

function Line({ label, value, ok }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
      <Text style={{ width: 120, fontSize: 12, fontWeight: '700', color: C.mute, letterSpacing: 0.2 }}>{label}</Text>
      <Text style={{ flex: 1, fontSize: 13.5, color: C.ink, fontWeight: ok ? '700' : '500' }}>{value}</Text>
    </View>
  );
}

export default function SafetyRecordCard({ member }) {
  const rec = safetyRecordFromEvents(member && member.events);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signed, setSigned] = useState(rec.clientSignoff);   // { name, at } once the client has signed
  const [urls, setUrls] = useState({});                      // photo path -> signed URL

  useEffect(() => {
    let alive = true;
    (async () => {
      const out = {};
      for (const p of rec.photos) {
        try { out[p.path] = await proofPhotoUrl(p.path); } catch (_) { /* skip a photo we can't resolve */ }
      }
      if (alive) setUrls(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member && member.assignment_id]);

  async function sign() {
    setBusy(true); setErr('');
    try {
      await submitSignoff(member.assignment_id, 'client', name.trim() || null);
      setSigned({ name: name.trim() || null, at: new Date().toISOString() });
    } catch (e) {
      setErr((e && e.message) || 'Could not record your sign-off. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const hazards = rec.prestart ? Object.keys(rec.prestart.triggers).filter((k) => rec.prestart.triggers[k]) : [];

  return (
    <View style={cardStyle}>
      <Text style={[T.bodyStrong, { marginBottom: 8 }]}>{(member && member.name) || 'Worker'}</Text>

      {/* prestart · hazards · SWMS */}
      {rec.prestart ? (
        <>
          <Line label="Safety prestart" value={`Completed${rec.prestart.hrcw ? ' · high-risk work' : ''}`} ok />
          <Line label="Hazards flagged" value={hazards.length ? hazards.map((h) => TRIGGER_LABEL[h] || h).join(', ') : 'None ticked'} />
          {rec.prestart.hrcw ? (
            <Line label="SWMS" value={rec.prestart.swmsAck ? 'Acknowledged by worker' : 'Not acknowledged'} ok={rec.prestart.swmsAck} />
          ) : null}
        </>
      ) : (
        <Line label="Safety prestart" value="Not required for this trade" />
      )}

      {/* on-site check-in */}
      {rec.checkin ? (
        <Line label="On-site check-in" value={rec.checkin.gpsOverride ? 'Confirmed (GPS override)' : 'Confirmed on site'} ok={!rec.checkin.flagged} />
      ) : null}

      {/* proof photos */}
      {rec.photos.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          <Text style={[T.small, { color: C.mute, marginBottom: 6, fontWeight: '700' }]}>Photos</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {rec.photos.map((p) => (
              urls[p.path]
                ? <Image key={p.path} source={{ uri: urls[p.path] }} style={photoStyle} />
                : <View key={p.path} style={[photoStyle, { alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={C.mute} /></View>
            ))}
          </View>
        </View>
      ) : null}

      {/* worker sign-off */}
      <Line label="Worker sign-off" value={rec.workerSignoff ? `Signed${rec.workerSignoff.name ? ` — ${rec.workerSignoff.name}` : ''}` : 'Not signed'} ok={!!rec.workerSignoff} />

      {/* client sign-off */}
      <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }}>
        {signed ? (
          <Text style={{ fontSize: 13.5, color: C.green, fontWeight: '700' }}>✓ You signed off{signed.name ? ` — ${signed.name}` : ''}</Text>
        ) : (
          <>
            <Text style={[T.small, { color: C.mute, marginBottom: 8 }]}>
              Sign to confirm you've reviewed this record. This captures your acknowledgement — it isn't a safety guarantee.
            </Text>
            <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Type your name to sign" placeholderTextColor={C.mute2} />
            {!!err && <Text style={{ fontSize: 12.5, color: C.red, marginTop: 6 }}>{err}</Text>}
            <TouchableOpacity onPress={sign} disabled={busy} activeOpacity={0.9} style={[signBtn, busy && { opacity: 0.6 }]}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>{busy ? 'Signing…' : 'Sign off'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const cardStyle = { backgroundColor: C.panel2 || '#F1F0EC', borderRadius: R.md, padding: 14, marginBottom: 10 };
const photoStyle = { width: 72, height: 72, borderRadius: 8, backgroundColor: C.line };
const inputStyle = { borderWidth: 1, borderColor: C.line, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.ink, backgroundColor: '#fff' };
const signBtn = { backgroundColor: C.indigo, borderRadius: R.sm, paddingVertical: 12, alignItems: 'center', marginTop: 8 };
