// ReceiptCapture.js — live receipt photo for a run, uploaded to storage only.
//
// Deliberately NOT a proof-photo (job_events) capture: a receipt's home is the
// materials-claim rail, not the compliance photo pipe. So this uploads the shot to
// the same Storage bucket via uploadProofPhoto() and hands the caller the stored
// path — the caller then attaches it to submitMaterialClaim() as the receiptUrl.
//
// Live camera only (same rule as ProofPhoto — genuine evidence, not a gallery pick).

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { C, S, R, T } from './theme';
import { uploadProofPhoto, proofPhotoUrl } from './complianceService';

let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch (_) { ImagePicker = null; }

// onCaptured(path) fires once the receipt image is stored. label optional.
export default function ReceiptCapture({ assignmentId, onCaptured, label = 'Receipt photo' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(false);

  async function capture() {
    setErr('');
    if (!ImagePicker || !ImagePicker.launchCameraAsync) { setErr('Camera unavailable on this device.'); return; }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setErr('Camera permission is needed to snap the receipt.'); return; }
    } catch (_) { setErr('Couldn’t access the camera.'); return; }

    let shot;
    try {
      shot = await ImagePicker.launchCameraAsync({ allowsEditing: false, quality: 0.5, exif: false });
    } catch (_) { setErr('Camera didn’t open. Try again.'); return; }
    if (shot.canceled || !shot.assets || !shot.assets[0]) return;

    setBusy(true);
    try {
      // Storage upload ONLY — returns the stored path (no job_events row).
      const path = await uploadProofPhoto(assignmentId, shot.assets[0].uri, 'receipt');
      try { setPreview(await proofPhotoUrl(path)); } catch (_) {}
      setDone(true);
      onCaptured && onCaptured(path);
    } catch (e) {
      setErr('Couldn’t upload the receipt (weak signal?). Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={{ borderRadius: R.md, backgroundColor: C.canvas, padding: S.md }}>
        <Text style={[T.body, { color: C.green, fontWeight: '700', marginBottom: preview ? S.sm : 0 }]}>{'✓'} {label} captured</Text>
        {preview ? <Image source={{ uri: preview }} style={{ width: '100%', height: 160, borderRadius: R.sm }} resizeMode="cover" /> : null}
      </View>
    );
  }

  return (
    <View style={{ borderRadius: R.md, backgroundColor: C.canvas, padding: S.md }}>
      <Text style={[T.body, { fontWeight: '700', marginBottom: 4 }]}>{label}</Text>
      <Text style={[T.small, { color: C.mute, marginBottom: S.md }]}>Snap the receipt so the client can reimburse what you spent.</Text>
      <TouchableOpacity
        onPress={capture}
        disabled={busy}
        activeOpacity={0.9}
        style={{ backgroundColor: busy ? C.mute : C.indigo, borderRadius: R.md, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 17 }}>{'🧾'}</Text>}
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{busy ? 'Uploading…' : 'Snap receipt'}</Text>
      </TouchableOpacity>
      {err ? <Text style={[T.small, { color: C.red, marginTop: S.sm }]}>{err}</Text> : null}
    </View>
  );
}
