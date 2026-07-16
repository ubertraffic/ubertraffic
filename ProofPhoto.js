// ProofPhoto.js — live proof-of-work photo capture (compliance spine).
//
// LIVE CAMERA ONLY — never the gallery. A proof photo must be genuine evidence the
// worker was on site, then; a gallery pick could be any old image. So this uses
// expo-image-picker's launchCameraAsync exclusively.
//
// The shot is GPS-stamped (captured at the moment of capture) so the photo carries
// where + when as evidence. Upload goes through complianceService. Honest degradation
// (CLAUDE.md): if the upload fails (dead-zone site), we surface a clear retry and do
// NOT pretend the proof was captured — the compliance gate reads real server events.

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { C, S, R, T } from './theme';
import { uploadAndRecordPhoto, proofPhotoUrl } from './complianceService';
import { getPosition } from './location';

let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch (_) { ImagePicker = null; }

// kind: 'arrival' | 'completion'. onCaptured(url) fires once the proof is recorded.
export default function ProofPhoto({ assignmentId, kind = 'completion', onCaptured, label }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null); // signed url of the captured shot
  const [done, setDone] = useState(false);

  const title = label || (kind === 'arrival' ? 'Arrival photo' : 'Completion photo');

  async function capture() {
    setErr('');
    if (!ImagePicker || !ImagePicker.launchCameraAsync) {
      setErr('Camera unavailable on this device.');
      return;
    }
    // Live camera requires permission.
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setErr('Camera permission is needed to capture proof.'); return; }
    } catch (_) { setErr('Couldn\u2019t access the camera.'); return; }

    let shot;
    try {
      shot = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.5,            // site proof doesn't need full resolution
        exif: false,
      });
    } catch (_) { setErr('Camera didn\u2019t open. Try again.'); return; }

    if (shot.canceled || !shot.assets || !shot.assets[0]) return; // worker backed out
    const uri = shot.assets[0].uri;

    setBusy(true);
    // Stamp the shot with GPS at capture time (best-effort; never blocks on it).
    let lat = null, lng = null;
    try { const p = await getPosition(); lat = p.lat; lng = p.lng; } catch (_) {}

    try {
      const { url } = await uploadAndRecordPhoto(assignmentId, uri, kind, { lat, lng });
      // show a preview so the worker sees it landed
      try { setPreview(await proofPhotoUrl(url)); } catch (_) {}
      setDone(true);
      onCaptured && onCaptured(url);
    } catch (e) {
      // Honest degradation: proof was NOT recorded. Say so plainly; offer retry.
      setErr('Couldn\u2019t upload the photo (weak signal?). Your work isn\u2019t lost — try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={{ borderRadius: R.md, backgroundColor: C.canvas, padding: S.md }}>
        <Text style={[T.body, { color: C.green, fontWeight: '700', marginBottom: preview ? S.sm : 0 }]}>
          {'\u2713'} {title} captured
        </Text>
        {preview ? (
          <Image source={{ uri: preview }} style={{ width: '100%', height: 160, borderRadius: R.sm }} resizeMode="cover" />
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ borderRadius: R.md, backgroundColor: C.canvas, padding: S.md }}>
      <Text style={[T.body, { fontWeight: '700', marginBottom: 4 }]}>{title}</Text>
      <Text style={[T.small, { color: C.mute, marginBottom: S.md }]}>
        Take a live photo on site as proof of work.
      </Text>

      <TouchableOpacity
        onPress={capture}
        disabled={busy}
        activeOpacity={0.9}
        style={{
          backgroundColor: busy ? C.mute : C.indigo,
          borderRadius: R.md, paddingVertical: 14, alignItems: 'center',
          flexDirection: 'row', justifyContent: 'center', gap: 8,
        }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 17 }}>{'\uD83D\uDCF7'}</Text>}
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>
          {busy ? 'Uploading\u2026' : 'Take proof photo'}
        </Text>
      </TouchableOpacity>

      {err ? <Text style={[T.small, { color: C.red, marginTop: S.sm }]}>{err}</Text> : null}
    </View>
  );
}
