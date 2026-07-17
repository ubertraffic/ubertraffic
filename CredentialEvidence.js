// CredentialEvidence.js — the worker adds a photo of a credential that has no free register check
// (driver's licence, HRWL, insurance, trade licences). The photo goes to a PRIVATE, owner-only
// bucket and lands the credential "In review" — it is NEVER auto-verified. Only an admin can verify
// after seeing the image. Honest interim (CLAUDE.md): a photo on file is a submission, not a check.
//
// Props: credentialId, existingPath (stored evidence path or null), onDone(path)
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { C, S, R, T } from './theme';
import { uploadCredentialEvidence, setCredentialEvidence, credentialEvidenceUrl } from './credentialsService';

let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch (_) { ImagePicker = null; }

export default function CredentialEvidence({ credentialId, existingPath, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(!!existingPath);

  useEffect(() => {
    let alive = true;
    (async () => { if (existingPath) { try { const u = await credentialEvidenceUrl(existingPath); if (alive) setPreview(u); } catch (_) {} } })();
    return () => { alive = false; };
  }, [existingPath]);

  async function pick(fromCamera) {
    setErr('');
    if (!ImagePicker) { setErr('Photo picker unavailable on this device.'); return; }
    if (fromCamera) {
      try {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setErr('Camera permission is needed to snap the card.'); return; }
      } catch (_) { setErr('Couldn’t access the camera.'); return; }
    }
    let shot;
    try {
      shot = fromCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.5, exif: false })
        : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, quality: 0.5, exif: false });
    } catch (_) { setErr('Couldn’t open the picker. Try again.'); return; }
    if (!shot || shot.canceled || !shot.assets || !shot.assets[0]) return;

    setBusy(true);
    try {
      const path = await uploadCredentialEvidence(credentialId, shot.assets[0].uri);
      await setCredentialEvidence(credentialId, path);
      try { setPreview(await credentialEvidenceUrl(path)); } catch (_) {}
      setDone(true);
      onDone && onDone(path);
    } catch (e) {
      setErr('Couldn’t upload (weak signal?). Try again when you have signal.');
    } finally { setBusy(false); }
  }

  return (
    <View style={{ backgroundColor: C.canvas, borderRadius: R.md, padding: S.md, marginTop: 8, marginBottom: 8 }}>
      <Text style={[T.small, { color: C.mute, lineHeight: 17, marginBottom: preview ? S.sm : S.md }]}>
        {done
          ? 'Photo on file — sent for review. It only unlocks once we’ve checked it. It’s private: never shown to clients.'
          : 'No online register for this one. Add a clear photo of the card so we can check it by hand. It’s private — only you and our reviewer ever see it, never clients.'}
      </Text>
      {preview ? (
        <Image source={{ uri: preview }} style={{ width: '100%', height: 150, borderRadius: R.sm, marginBottom: S.md }} resizeMode="cover" />
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity
          onPress={() => pick(true)}
          disabled={busy}
          activeOpacity={0.9}
          style={{ flex: 1, backgroundColor: busy ? C.mute : C.indigo, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15 }}>📷</Text>}
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>{busy ? 'Uploading…' : (done ? 'Retake' : 'Take photo')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => pick(false)}
          disabled={busy}
          activeOpacity={0.9}
          style={{ flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: C.indigo, fontWeight: '700', fontSize: 14 }}>Choose photo</Text>
        </TouchableOpacity>
      </View>
      {err ? <Text style={[T.small, { color: C.red, marginTop: S.sm }]}>{err}</Text> : null}
    </View>
  );
}
